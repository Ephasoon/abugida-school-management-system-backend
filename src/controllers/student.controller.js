// src/controllers/student.controller.js
// ============================================================
// Handles all student-related operations:
//   POST   /api/students          → register new student
//   GET    /api/students          → list all (search + paginate)
//   GET    /api/students/:id      → single student full profile
//   PUT    /api/students/:id      → update student
//   DELETE /api/students/:id      → archive (soft delete)
//   GET    /api/students/:id/summary → grades + attendance + fees
// ============================================================

const db                     = require('../config/db');
const { sendSuccess,
        sendError }          = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const { setUserActive }   = require('../utils/sessions');
const { readAmharicNames, amharicSet, STUDENT_AM } = require('../utils/amharicNames');
const { scopeCondition } = require('../utils/scope');
const { isUuid }         = require('../middleware/validateIds.middleware');
const { rateSql } = require('../utils/attendance');
const RATE   = rateSql();   // attendance rate (M4): late attended, excused left out

const STUDENT_STATUSES = ['active', 'graduated', 'withdrawn', 'suspended'];
// Optional text fields and their lengths: an update clears them with '' or null
const OPTIONAL_TEXT = { fathers_name: 100, phone: 20, address: 2000, region: 100, woreda: 100, previous_school: 255, notes: 5000 };
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

// ── Helper: Generate Student Number ─────────────────────────
// Format: ASMS-<year>-<NNN>. NNN comes from student_number_seq (migration 014),
// so concurrent registrations never get the same number. NNN does not reset yearly.
const generateStudentNumber = async () => {
  const year = new Date().getFullYear();
  const { rows } = await db.query("SELECT nextval('student_number_seq') AS n");
  const padded = String(rows[0].n).padStart(3, '0');
  return `ASMS-${year}-${padded}`;
};


// ── POST /api/students ───────────────────────────────────────
// Register a new student. Admin only.
const createStudent = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      fathers_name,
      date_of_birth,
      gender,
      class_id,
      phone,
      address,
      region,
      woreda,
      previous_school,
      notes,
    } = req.body;

    // 1. Validate required fields
    if (!first_name || !last_name || !gender) {
      return sendError(res, 'first_name, last_name, and gender are required.', 400);
    }

    if (!['male', 'female'].includes(gender)) {
      return sendError(res, 'gender must be "male" or "female".', 400);
    }

    const am = readAmharicNames(req.body, STUDENT_AM);
    if (am.error) return sendError(res, am.error, 400);

    // 2. class_id exists: validateBodyIds on the route. A bad date is a 400, not a 500
    if (date_of_birth && !isIsoDate(date_of_birth)) {
      return sendError(res, 'date_of_birth must be a date (YYYY-MM-DD).', 400);
    }

    // 3. Generate unique student number
    const student_number = await generateStudentNumber();

    // 4. Insert the student
    const { rows } = await db.query(
      `INSERT INTO students (
        student_number, first_name, last_name, fathers_name,
        date_of_birth, gender, class_id, phone, address,
        region, woreda, previous_school, notes,
        first_name_am, fathers_name_am, last_name_am
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      ) RETURNING *`,
      [
        student_number,
        first_name.trim(),
        last_name.trim(),
        fathers_name?.trim() || null,
        date_of_birth || null,
        gender,
        class_id || null,
        phone?.trim() || null,
        address?.trim() || null,
        region?.trim() || null,
        woreda?.trim() || null,
        previous_school?.trim() || null,
        notes?.trim() || null,
        am.values.first_name_am ?? null,
        am.values.fathers_name_am ?? null,
        am.values.last_name_am ?? null,
      ]
    );

    // 5. Log to audit trail
    await db.query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, new_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'student.created', 'student', rows[0].id, JSON.stringify(rows[0])]
    );

    return sendSuccess(res, rows[0], `Student ${student_number} registered successfully.`, 201);

  } catch (err) {
    return sendServerError(res, err, 'Server error while registering student.');
  }
};


// ── GET /api/students ────────────────────────────────────────
// List all students with search, filter, and pagination.
const getStudents = async (req, res) => {
  try {
    const {
      search   = '',
      class_id = '',
      status   = 'active',
      gender   = '',
    } = req.query;

    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);
    const { page, limit, offset } = pg;

    // Bad filters are the client's mistake (400), never an enum or uuid error (500)
    if (!['all', ...STUDENT_STATUSES].includes(status)) {
      return sendError(res, `status must be one of: all, ${STUDENT_STATUSES.join(', ')}.`, 400);
    }
    if (gender && !['male', 'female'].includes(gender)) return sendError(res, 'gender must be male or female.', 400);
    if (class_id) {
      const known = isUuid(class_id) && (await db.query('SELECT 1 FROM classes WHERE id = $1', [class_id])).rows.length;
      if (!known) return sendError(res, 'class_id does not exist.', 400, { field: 'class_id' });
    }

    // Build dynamic WHERE clause
    const conditions = [];
    const params     = [];
    let   paramIdx   = 1;

    // Status: one, or every status with status=all
    if (status !== 'all') {
      conditions.push(`s.status = $${paramIdx++}`);
      params.push(status);
    }

    // Search by name or student number
    if (search.trim()) {
      conditions.push(`(
        s.first_name ILIKE $${paramIdx}   OR
        s.last_name  ILIKE $${paramIdx}   OR
        s.fathers_name ILIKE $${paramIdx} OR
        s.first_name_am ILIKE $${paramIdx} OR
        s.fathers_name_am ILIKE $${paramIdx} OR
        s.last_name_am ILIKE $${paramIdx} OR
        s.student_number ILIKE $${paramIdx}
      )`);
      params.push(`%${search.trim()}%`);
      paramIdx++;
    }

    // Filter by class
    if (class_id) {
      conditions.push(`s.class_id = $${paramIdx++}`);
      params.push(class_id);
    }

    // Filter by gender
    if (gender) {
      conditions.push(`s.gender = $${paramIdx++}`);
      params.push(gender);
    }

    // Teachers only see students in their own classes (admin/principal: all)
    const scoped = await scopeCondition(req.user, 's.class_id', params);
    if (scoped) { conditions.push(scoped); paramIdx = params.length + 1; }

    const whereClause = conditions.length
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // Get total count for pagination
    const countResult = await db.query(
      `SELECT COUNT(*) FROM students s ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get the actual data
    const { rows } = await db.query(
      `SELECT
         s.id,
         s.student_number,
         s.first_name,
         s.last_name,
         s.fathers_name,
         s.first_name_am,
         s.fathers_name_am,
         s.last_name_am,
         s.gender,
         s.date_of_birth,
         s.phone,
         s.status,
         s.enrollment_date,
         s.photo_url,
         -- Class info joined in
         s.class_id,
         c.name        AS class_name,
         c.grade_level AS grade_level,
         c.section     AS section
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       ${whereClause}
       ORDER BY s.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), offset]
    );

    return sendSuccess(res, {
      students:   rows,
      pagination: {
        total,
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    }, `Found ${total} student(s).`);

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching students.');
  }
};


// ── GET /api/students/:id ────────────────────────────────────
// Get a single student's full profile including class and parents.
const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get student + class details
    const { rows } = await db.query(
      `SELECT
         s.*,
         c.name        AS class_name,
         c.grade_level,
         c.section,
         c.academic_year_id,
         ay.name       AS academic_year,
         ay.end_date   AS academic_year_end
       FROM students s
       LEFT JOIN classes       c  ON c.id  = s.class_id
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE s.id = $1`,
      [id]
    );

    if (!rows[0]) {
      return sendError(res, 'Student not found.', 404);
    }

    const student = rows[0];

    // Parents and guardians (G7): relationship and primary contact; the
    // primary contact first, then by name
    const { rows: parents } = await db.query(
      `SELECT
         p.id, p.full_name, p.full_name_am, p.phone, p.phone_secondary,
         p.email, p.occupation,
         sp.relationship, sp.is_primary
       FROM parents p
       JOIN student_parents sp ON sp.parent_id = p.id
       WHERE sp.student_id = $1
       ORDER BY sp.is_primary DESC, p.full_name, p.id`,
      [id]
    );

    student.parents = parents;

    // Internal staff notes are not shown to students and parents
    if (req.user.role === 'student' || req.user.role === 'parent') delete student.notes;

    return sendSuccess(res, student, 'Student profile retrieved.');

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching student.');
  }
};


// ── PUT /api/students/:id ────────────────────────────────────
// Update student record. Admin only.
const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;

    // Check student exists
    const existing = await db.query(
      'SELECT * FROM students WHERE id = $1', [id]
    );
    if (!existing.rows[0]) {
      return sendError(res, 'Student not found.', 404);
    }

    // Only the fields sent change. first_name / last_name cannot be emptied;
    // the optional fields (incl. class_id and date_of_birth) are cleared with
    // '' or null. class_id itself is checked by validateBodyIds on the route.
    const b = req.body || {};
    const sent = (k) => Object.prototype.hasOwnProperty.call(b, k);
    const values = {};
    for (const k of ['first_name', 'last_name']) {
      if (!sent(k)) continue;
      if (typeof b[k] !== 'string' || !b[k].trim()) return sendError(res, `${k} cannot be empty.`, 400);
      if (b[k].trim().length > 100) return sendError(res, `${k} must be at most 100 characters.`, 400);
      values[k] = b[k].trim();
    }
    const opt = readAmharicNames(b, OPTIONAL_TEXT); // text, length, '' / null clear
    if (opt.error) return sendError(res, opt.error, 400);
    Object.assign(values, opt.values);
    if (sent('gender')) {
      if (!['male', 'female'].includes(b.gender)) return sendError(res, 'gender must be "male" or "female".', 400);
      values.gender = b.gender;
    }
    if (sent('status')) {
      if (!STUDENT_STATUSES.includes(b.status)) return sendError(res, `status must be one of: ${STUDENT_STATUSES.join(', ')}.`, 400);
      values.status = b.status;
    }
    if (sent('date_of_birth')) {
      if (b.date_of_birth && !isIsoDate(b.date_of_birth)) return sendError(res, 'date_of_birth must be a date (YYYY-MM-DD).', 400);
      values.date_of_birth = b.date_of_birth || null;
    }
    if (sent('class_id')) values.class_id = b.class_id || null;

    const am = readAmharicNames(b, STUDENT_AM);
    if (am.error) return sendError(res, am.error, 400);
    Object.assign(values, am.values);

    const set = amharicSet(values, 2); // "field = $n" for each value sent
    const { rows } = await db.query(
      `UPDATE students SET updated_at = NOW()${set.sql} WHERE id = $1 RETURNING *`,
      [id, ...set.params]
    );

    // A status change syncs the login: any status other than 'active' disables
    // it, back to 'active' enables it. An unchanged status leaves it alone, so
    // editing a student doesn't undo PUT /accounts/students/:id/status.
    if (values.status && values.status !== existing.rows[0].status) {
      await setUserActive(rows[0].user_id, rows[0].status === 'active');
    }

    // Log change
    await db.query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id, old_data, new_data)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req.user.id, 'student.updated', 'student', id,
        JSON.stringify(existing.rows[0]),
        JSON.stringify(rows[0])
      ]
    );

    return sendSuccess(res, rows[0], 'Student updated successfully.');

  } catch (err) {
    return sendServerError(res, err, 'Server error while updating student.');
  }
};


// ── DELETE /api/students/:id ─────────────────────────────────
// Soft delete — sets status to 'withdrawn'. Never hard deletes.
const archiveStudent = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await db.query(
      `UPDATE students
       SET status = 'withdrawn', updated_at = NOW()
       WHERE id = $1
       RETURNING student_number, first_name, last_name, user_id`,
      [id]
    );

    if (!rows[0]) {
      return sendError(res, 'Student not found.', 404);
    }

    await setUserActive(rows[0].user_id, false);

    await db.query(
      `INSERT INTO audit_logs (user_id, action, target_type, target_id)
       VALUES ($1, 'student.archived', 'student', $2)`,
      [req.user.id, id]
    );

    return sendSuccess(
      res, null,
      `Student ${rows[0].student_number} (${rows[0].first_name} ${rows[0].last_name}) archived.`
    );

  } catch (err) {
    return sendServerError(res, err, 'Server error while archiving student.');
  }
};


// ── GET /api/students/:id/summary ───────────────────────────
// Returns a quick dashboard summary for one student:
// recent grades, attendance rate, and fee balance.
const getStudentSummary = async (req, res) => {
  try {
    const { id } = req.params;

    // Attendance rate this month
    const { rows: attRows } = await db.query(
      `SELECT
         COUNT(*)                                          AS total_days,
         COUNT(*) FILTER (WHERE status = 'present')       AS present_days,
         COUNT(*) FILTER (WHERE status = 'absent')        AS absent_days,
         COUNT(*) FILTER (WHERE status = 'late')          AS late_days,
         ${RATE}                                                AS attendance_rate
       FROM attendance
       WHERE student_id = $1
         AND date >= date_trunc('month', CURRENT_DATE)`,
      [id]
    );

    // Recent grades (last 5)
    const { rows: gradeRows } = await db.query(
      `SELECT
         g.score, g.grade_letter,
         sub.name  AS subject,
         e.name    AS exam_name,
         e.term,
         e.exam_date
       FROM grades g
       JOIN exams    e   ON e.id   = g.exam_id
       JOIN subjects sub ON sub.id = e.subject_id
       WHERE g.student_id = $1
       ORDER BY e.exam_date DESC NULLS LAST
       LIMIT 5`,
      [id]
    );

    // Fee balance
    const { rows: feeRows } = await db.query(
      `SELECT
         COALESCE(SUM(amount_due),  0) AS total_due,
         COALESCE(SUM(amount_paid), 0) AS total_paid,
         COALESCE(SUM(amount_due) - SUM(amount_paid), 0) AS balance
       FROM payments
       WHERE student_id = $1`,
      [id]
    );

    return sendSuccess(res, {
      attendance:   attRows[0],
      recentGrades: gradeRows,
      fees:         feeRows[0],
    }, 'Student summary retrieved.');

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching student summary.');
  }
};


module.exports = {
  createStudent,
  getStudents,
  getStudentById,
  updateStudent,
  archiveStudent,
  getStudentSummary,
};
