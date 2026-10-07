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
const { parsePagination } = require('../utils/pagination');
const { setUserActive }   = require('../utils/sessions');

// ── Helper: Generate Student Number ─────────────────────────
// Format: ASMS-2024-001, ASMS-2024-002, etc.
const generateStudentNumber = async () => {
  const year = new Date().getFullYear();
  const { rows } = await db.query(
    `SELECT COUNT(*) FROM students
     WHERE student_number LIKE $1`,
    [`ASMS-${year}-%`]
  );
  const count  = parseInt(rows[0].count) + 1;
  const padded = String(count).padStart(3, '0');
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

    // 2. Validate class exists (if provided)
    if (class_id) {
      const { rows } = await db.query(
        'SELECT id FROM classes WHERE id = $1', [class_id]
      );
      if (!rows[0]) {
        return sendError(res, 'class_id does not exist.', 400);
      }
    }

    // 3. Generate unique student number
    const student_number = await generateStudentNumber();

    // 4. Insert the student
    const { rows } = await db.query(
      `INSERT INTO students (
        student_number, first_name, last_name, fathers_name,
        date_of_birth, gender, class_id, phone, address,
        region, woreda, previous_school, notes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
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
    console.error('createStudent error:', err);
    return sendError(res, 'Server error while registering student.', 500);
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

    // Build dynamic WHERE clause
    const conditions = [];
    const params     = [];
    let   paramIdx   = 1;

    // Always filter by status
    conditions.push(`s.status = $${paramIdx++}`);
    params.push(status);

    // Search by name or student number
    if (search.trim()) {
      conditions.push(`(
        s.first_name ILIKE $${paramIdx}   OR
        s.last_name  ILIKE $${paramIdx}   OR
        s.fathers_name ILIKE $${paramIdx} OR
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
         s.gender,
         s.date_of_birth,
         s.phone,
         s.status,
         s.enrollment_date,
         s.photo_url,
         -- Class info joined in
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
    console.error('getStudents error:', err);
    return sendError(res, 'Server error while fetching students.', 500);
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
         ay.name       AS academic_year
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

    // Get student's parents/guardians
    const { rows: parents } = await db.query(
      `SELECT
         p.id, p.full_name, p.phone, p.phone_secondary,
         p.email, p.occupation,
         sp.relationship, sp.is_primary
       FROM parents p
       JOIN student_parents sp ON sp.parent_id = p.id
       WHERE sp.student_id = $1
       ORDER BY sp.is_primary DESC`,
      [id]
    );

    student.parents = parents;

    return sendSuccess(res, student, 'Student profile retrieved.');

  } catch (err) {
    console.error('getStudentById error:', err);
    return sendError(res, 'Server error while fetching student.', 500);
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

    const {
      first_name, last_name, fathers_name,
      date_of_birth, gender, class_id,
      phone, address, region, woreda,
      previous_school, status, notes,
    } = req.body;

    const { rows } = await db.query(
      `UPDATE students SET
        first_name      = COALESCE($1,  first_name),
        last_name       = COALESCE($2,  last_name),
        fathers_name    = COALESCE($3,  fathers_name),
        date_of_birth   = COALESCE($4,  date_of_birth),
        gender          = COALESCE($5,  gender),
        class_id        = COALESCE($6,  class_id),
        phone           = COALESCE($7,  phone),
        address         = COALESCE($8,  address),
        region          = COALESCE($9,  region),
        woreda          = COALESCE($10, woreda),
        previous_school = COALESCE($11, previous_school),
        status          = COALESCE($12, status),
        notes           = COALESCE($13, notes),
        updated_at      = NOW()
      WHERE id = $14
      RETURNING *`,
      [
        first_name, last_name, fathers_name,
        date_of_birth, gender, class_id,
        phone, address, region, woreda,
        previous_school, status, notes,
        id
      ]
    );

    // Any status other than 'active' disables the student's login (if any)
    if (status) {
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
    console.error('updateStudent error:', err);
    return sendError(res, 'Server error while updating student.', 500);
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
    console.error('archiveStudent error:', err);
    return sendError(res, 'Server error while archiving student.', 500);
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
         ROUND(
           COUNT(*) FILTER (WHERE status = 'present') * 100.0
           / NULLIF(COUNT(*), 0), 1
         )                                                AS attendance_rate
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
    console.error('getStudentSummary error:', err);
    return sendError(res, 'Server error while fetching student summary.', 500);
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
