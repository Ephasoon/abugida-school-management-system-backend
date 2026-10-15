// src/controllers/teacher.controller.js
// ============================================================
// Handles all teacher operations:
//   POST /api/teachers              → add new teacher + login account
//   GET  /api/teachers              → list all teachers
//   GET  /api/teachers/:id          → single teacher profile
//   PUT  /api/teachers/:id          → update teacher
//   POST /api/teachers/:id/subjects → assign subjects
//   POST /api/teachers/:id/classes  → assign to class+subject
//   DELETE /api/teachers/:id/classes/:classId/:subjectId → remove that assignment
//   GET  /api/teachers/subjects     → list all subjects
// ============================================================

const db                 = require('../config/db');
const bcrypt             = require('bcryptjs');
const { sendSuccess,
        sendError }      = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { generateTemporaryPassword } = require('../utils/password');
const { setUserActive }  = require('../utils/sessions');
const { audit }          = require('../utils/audit');
const { inTransaction }  = require('../utils/transaction');
const { readAmharicNames, amharicSet, TEACHER_AM } = require('../utils/amharicNames');


// ── Helper: Generate Teacher Number ──────────────────────────
// TCH-<NNN> from teacher_number_seq (migration 014): unique even under concurrency
const generateTeacherNumber = async () => {
  const { rows } = await db.query("SELECT nextval('teacher_number_seq') AS n");
  return `TCH-${String(rows[0].n).padStart(3, '0')}`;
};


// ── POST /api/teachers ───────────────────────────────────────
const createTeacher = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      first_name, last_name, email, phone,
      gender, specialization, qualification,
      hire_date,
    } = req.body;

    if (!first_name || !last_name || !email) {
      return sendError(res, 'first_name, last_name, and email are required.', 400);
    }
    const am = readAmharicNames(req.body, TEACHER_AM);
    if (am.error) return sendError(res, am.error, 400);

    // Check email not already taken
    const { rows: existing } = await db.query(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase()]
    );
    if (existing[0]) {
      return sendError(res, 'A user with this email already exists.', 409);
    }

    await client.query('BEGIN');

    // 1. Create login account with a one-time temporary password.
    //    must_change_password blocks every route until the teacher sets their own.
    const temporaryPassword = generateTemporaryPassword();
    const hash = await bcrypt.hash(temporaryPassword, 12);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, role, must_change_password)
       VALUES ($1, $2, 'teacher', TRUE) RETURNING id`,
      [email.toLowerCase().trim(), hash]
    );

    // 2. Create teacher profile
    const teacher_number = await generateTeacherNumber();
    const { rows } = await client.query(
      `INSERT INTO teachers
         (user_id, teacher_number, first_name, last_name,
          phone, gender, specialization, qualification, hire_date,
          first_name_am, last_name_am)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        userRows[0].id, teacher_number,
        first_name.trim(), last_name.trim(),
        phone?.trim() || null, gender || null,
        specialization?.trim() || null,
        qualification?.trim() || null,
        hire_date || null,
        am.values.first_name_am ?? null,
        am.values.last_name_am ?? null,
      ]
    );

    await client.query('COMMIT');

    // The temporary password is returned exactly once, in its own field.
    // It is never stored in plain text or included in the message.
    return sendSuccess(res, {
      ...rows[0], email,
      temporary_password: temporaryPassword,
    }, `Teacher ${teacher_number} added. Share the temporary password privately; it must be changed at first login.`, 201);

  } catch (err) {
    await client.query('ROLLBACK');
    return sendServerError(res, err, 'Server error while adding teacher.');
  } finally {
    client.release();
  }
};


// ── GET /api/teachers ────────────────────────────────────────
const getTeachers = async (req, res) => {
  try {
    // status: active (default, as before) | inactive | all
    const { search = '', status = 'active' } = req.query;
    if (!['active', 'inactive', 'all'].includes(status)) {
      return sendError(res, 'status must be one of: active, inactive, all', 400);
    }
    const params = [];
    const conditions = [];
    if (status !== 'all') {
      params.push(status === 'active');
      conditions.push(`t.is_active = $${params.length}`);
    }
    if (String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      const n = params.length;
      conditions.push(`(t.first_name ILIKE $${n} OR t.last_name ILIKE $${n} OR t.teacher_number ILIKE $${n}
        OR t.first_name_am ILIKE $${n} OR t.last_name_am ILIKE $${n} OR u.email ILIKE $${n}
        OR (t.first_name || ' ' || t.last_name) ILIKE $${n}
        OR (t.first_name_am || ' ' || t.last_name_am) ILIKE $${n})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT
         t.id, t.teacher_number, t.first_name, t.last_name,
         t.first_name_am, t.last_name_am,
         t.phone, t.gender, t.specialization, t.qualification,
         t.hire_date, t.is_active, t.photo_url, t.created_at,
         u.email,
         ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) AS subjects,
         ARRAY_AGG(DISTINCT s.id)   FILTER (WHERE s.id   IS NOT NULL) AS subject_ids,
         COUNT(DISTINCT cc.id) AS class_count  -- classes of the current year
       FROM teachers t
       LEFT JOIN users            u  ON u.id  = t.user_id
       LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
       LEFT JOIN subjects         s  ON s.id  = ts.subject_id
       LEFT JOIN teacher_classes  tc ON tc.teacher_id = t.id
       LEFT JOIN classes          cc ON cc.id = tc.class_id
                                    AND cc.academic_year_id = (SELECT id FROM academic_years WHERE is_current)
       ${where}
       GROUP BY t.id, u.email
       ORDER BY t.created_at DESC`,
      params
    );

    return sendSuccess(res, rows, `Found ${rows.length} teacher(s).`);

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching teachers.');
  }
};


// ── GET /api/teachers/:id ────────────────────────────────────
const getTeacherById = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await db.query(
      `SELECT t.*, u.email FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
      [id]
    );
    if (!rows[0]) return sendError(res, 'Teacher not found.', 404);

    const teacher = rows[0];

    const { rows: subjects } = await db.query(
      `SELECT s.id, s.name, s.name_am, s.code FROM subjects s
       JOIN teacher_subjects ts ON ts.subject_id = s.id
       WHERE ts.teacher_id = $1`, [id]
    );

    const { rows: classes } = await db.query(
      `SELECT c.id, c.name, c.grade_level, c.section, tc.subject_id, s.name AS subject_name,
              s.name_am AS subject_name_am
       FROM teacher_classes tc
       JOIN classes  c ON c.id = tc.class_id
       JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.is_current  -- this year's classes (M7a)
       JOIN subjects s ON s.id = tc.subject_id
       WHERE tc.teacher_id = $1 ORDER BY c.grade_level, c.section`, [id]
    );

    teacher.subjects = subjects;
    teacher.classes  = classes;

    return sendSuccess(res, teacher, 'Teacher profile retrieved.');

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── PUT /api/teachers/:id ────────────────────────────────────
// Changes only the fields sent. first_name / last_name cannot be emptied;
// phone, specialization, qualification and the Amharic names are cleared
// with '' or null. is_active (true/false) also enables or disables the login
// (disabling revokes every session); a change of status is audited like the
// account actions (account.teacher_deactivated / _reactivated).
const CLEARABLE = { phone: 20, specialization: 100, qualification: 100 };

const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, gender, hire_date, is_active } = req.body;
    for (const [k, v] of Object.entries({ first_name, last_name })) {
      if (v !== undefined && (typeof v !== 'string' || !v.trim())) return sendError(res, `${k} cannot be empty.`, 400);
    }
    if (is_active !== undefined && is_active !== null && typeof is_active !== 'boolean') {
      return sendError(res, 'is_active must be true or false.', 400);
    }
    const am = readAmharicNames(req.body, TEACHER_AM);
    if (am.error) return sendError(res, am.error, 400);
    const opt = readAmharicNames(req.body, CLEARABLE); // same rules: text, length, '' / null clear
    if (opt.error) return sendError(res, opt.error, 400);
    const set = amharicSet({ ...opt.values, ...am.values }, 7);

    const result = await inTransaction(async (client) => {
      const { rows: before } = await client.query(
        `SELECT t.is_active, t.user_id, u.email FROM teachers t LEFT JOIN users u ON u.id = t.user_id
         WHERE t.id = $1 FOR UPDATE OF t`, [id]);
      if (!before[0]) return null;

      const { rows } = await client.query(
        `UPDATE teachers SET
           first_name = COALESCE($1, first_name),
           last_name  = COALESCE($2, last_name),
           gender     = COALESCE($3, gender),
           hire_date  = COALESCE($4, hire_date),
           is_active  = COALESCE($5, is_active),
           updated_at = NOW()${set.sql}
         WHERE id = $6 RETURNING *`,
        [first_name?.trim(), last_name?.trim(), gender, hire_date, is_active, id, ...set.params]
      );

      if (typeof is_active === 'boolean') await setUserActive(rows[0].user_id, is_active, client);
      if (typeof is_active === 'boolean' && is_active !== before[0].is_active) {
        await audit(client, req, `account.teacher_${is_active ? 'reactivated' : 'deactivated'}`,
          'user', rows[0].user_id, { email: before[0].email, teacher_id: id });
      }
      return rows[0];
    });
    if (!result) return sendError(res, 'Teacher not found.', 404);
    return sendSuccess(res, result, 'Teacher updated.');

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── POST /api/teachers/:id/subjects ──────────────────────────
// Replaces the teacher's subject list in one transaction, audited as
// teacher.subjects_changed with the list before and after.
const assignSubjects = async (req, res) => {
  try {
    const { id }          = req.params;
    const { subject_ids } = req.body;

    if (!Array.isArray(subject_ids) || subject_ids.some((x) => typeof x !== 'string')) {
      return sendError(res, 'subject_ids array is required.', 400);
    }
    // Each id exists: checked by validateBodyIds (400 subject_ids[i] does not exist.)
    const ids = [...new Set(subject_ids.map((x) => x.toLowerCase()))];

    const result = await inTransaction(async (client) => {
      const { rows: t } = await client.query('SELECT id FROM teachers WHERE id = $1 FOR UPDATE', [id]);
      if (!t[0]) return { status: 404, message: 'Teacher not found.' };

      const { rows: old } = await client.query(
        'SELECT subject_id FROM teacher_subjects WHERE teacher_id = $1 ORDER BY subject_id', [id]);
      await client.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [id]);
      if (ids.length) {
        await client.query(
          `INSERT INTO teacher_subjects (teacher_id, subject_id)
           SELECT $1, x::uuid FROM unnest($2::text[]) AS x`, [id, ids]);
      }
      const before = old.map((r) => r.subject_id);
      await audit(client, req, 'teacher.subjects_changed', 'teacher', id, {
        subject_ids: [...ids].sort(),
        added:   ids.filter((x) => !before.includes(x)),
        removed: before.filter((x) => !ids.includes(x)),
      });
      return null;
    });
    if (result) return sendError(res, result.message, result.status);
    return sendSuccess(res, null, `${ids.length} subject(s) assigned.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── POST /api/teachers/:id/classes ───────────────────────────
// The teacher must be active, and class_id / subject_id must exist (400
// naming the field: validateBodyIds on the route). A subject outside the teacher's
// own subject list is allowed (BACKLOG decision 2026-10-11); the response
// says so in outside_subject_list. A duplicate answers 409. The insert and
// its audit entry are one transaction.
const assignClass = async (req, res) => {
  try {
    const { id }                   = req.params;
    const { class_id, subject_id } = req.body;

    if (!class_id || !subject_id) {
      return sendError(res, 'class_id and subject_id are required.', 400);
    }

    const { rows: t } = await db.query(
      'SELECT id, first_name, last_name, is_active FROM teachers WHERE id = $1', [id]);
    if (!t[0]) return sendError(res, 'Teacher not found.', 404);
    if (!t[0].is_active) {
      return sendError(res, 'This teacher is deactivated. Reactivate the teacher before assigning classes.', 400);
    }

    // Both ids exist (validateBodyIds); loaded here for their names
    const { rows: c } = await db.query('SELECT id, name FROM classes WHERE id = $1', [class_id]);
    const { rows: s } = await db.query('SELECT id, name FROM subjects WHERE id = $1', [subject_id]);

    const { rows: own } = await db.query(
      'SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2', [id, s[0].id]);
    const outsideSubjectList = own.length === 0;

    const assignment = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO teacher_classes (teacher_id, class_id, subject_id)
         VALUES ($1,$2,$3) ON CONFLICT (teacher_id, class_id, subject_id) DO NOTHING
         RETURNING id, teacher_id, class_id, subject_id, created_at`,
        [id, c[0].id, s[0].id]
      );
      if (!rows[0]) return null;
      await audit(client, req, 'teacher.class_assigned', 'teacher', id, {
        class_id: c[0].id, subject_id: s[0].id, outside_subject_list: outsideSubjectList,
      });
      return rows[0];
    });

    const who = `${t[0].first_name} ${t[0].last_name}`;
    if (!assignment) {
      return sendError(res, `${who} is already assigned to ${s[0].name} in ${c[0].name}.`, 409);
    }
    return sendSuccess(res, { ...assignment, outside_subject_list: outsideSubjectList },
      `${who} assigned to ${s[0].name} in ${c[0].name}.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── DELETE /api/teachers/:id/classes/:classId/:subjectId ─────
const removeClassAssignment = async (req, res) => {
  try {
    const { id, classId, subjectId } = req.params;

    const removed = await inTransaction(async (client) => {
      // ::text comparison: a malformed id simply matches nothing (404, not 500)
      const { rows } = await client.query(
        `DELETE FROM teacher_classes
         WHERE teacher_id::text = $1 AND class_id::text = $2 AND subject_id::text = $3
         RETURNING id, class_id, subject_id`,
        [id, classId, subjectId]
      );
      if (!rows[0]) return null;
      await audit(client, req, 'teacher.class_unassigned', 'teacher', id, {
        class_id: rows[0].class_id, subject_id: rows[0].subject_id,
      });
      return rows[0];
    });
    if (!removed) return sendError(res, 'Assignment not found.', 404);
    return sendSuccess(res, null, 'Teacher removed from class.');

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/teachers/subjects ───────────────────────────────
const getAllSubjects = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, name_am, code FROM subjects ORDER BY name'
    );
    return sendSuccess(res, rows, `${rows.length} subject(s) found.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


module.exports = {
  createTeacher, getTeachers, getTeacherById,
  updateTeacher, assignSubjects, assignClass, removeClassAssignment, getAllSubjects,
};
