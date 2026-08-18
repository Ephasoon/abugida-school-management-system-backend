// src/controllers/teacher.controller.js
// ============================================================
// Handles all teacher operations:
//   POST /api/teachers              → add new teacher + login account
//   GET  /api/teachers              → list all teachers
//   GET  /api/teachers/:id          → single teacher profile
//   PUT  /api/teachers/:id          → update teacher
//   POST /api/teachers/:id/subjects → assign subjects
//   POST /api/teachers/:id/classes  → assign to class+subject
//   GET  /api/teachers/subjects     → list all subjects
// ============================================================

const db                 = require('../config/db');
const bcrypt             = require('bcryptjs');
const { sendSuccess,
        sendError }      = require('../utils/response');


// ── Helper: Generate Teacher Number ──────────────────────────
const generateTeacherNumber = async () => {
  const { rows } = await db.query('SELECT COUNT(*) FROM teachers');
  const count    = parseInt(rows[0].count) + 1;
  return `TCH-${String(count).padStart(3, '0')}`;
};


// ── POST /api/teachers ───────────────────────────────────────
const createTeacher = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      first_name, last_name, email, phone,
      gender, specialization, qualification,
      hire_date, password = 'Teacher@1234',
    } = req.body;

    if (!first_name || !last_name || !email) {
      return sendError(res, 'first_name, last_name, and email are required.', 400);
    }

    // Check email not already taken
    const { rows: existing } = await db.query(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase()]
    );
    if (existing[0]) {
      return sendError(res, 'A user with this email already exists.', 409);
    }

    await client.query('BEGIN');

    // 1. Create login account
    const hash = await bcrypt.hash(password, 12);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'teacher') RETURNING id`,
      [email.toLowerCase().trim(), hash]
    );

    // 2. Create teacher profile
    const teacher_number = await generateTeacherNumber();
    const { rows } = await client.query(
      `INSERT INTO teachers
         (user_id, teacher_number, first_name, last_name,
          phone, gender, specialization, qualification, hire_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        userRows[0].id, teacher_number,
        first_name.trim(), last_name.trim(),
        phone?.trim() || null, gender || null,
        specialization?.trim() || null,
        qualification?.trim() || null,
        hire_date || null,
      ]
    );

    await client.query('COMMIT');

    return sendSuccess(res, {
      ...rows[0], email,
      login_password: password,
    }, `Teacher ${teacher_number} added. Login: ${email} / ${password}`, 201);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createTeacher error:', err);
    return sendError(res, 'Server error while adding teacher.', 500);
  } finally {
    client.release();
  }
};


// ── GET /api/teachers ────────────────────────────────────────
const getTeachers = async (req, res) => {
  try {
    const { search = '' } = req.query;
    const params = [true];
    let   where  = 'WHERE t.is_active = $1';

    if (search.trim()) {
      where += ` AND (t.first_name ILIKE $2 OR t.last_name ILIKE $2 OR t.teacher_number ILIKE $2)`;
      params.push(`%${search.trim()}%`);
    }

    const { rows } = await db.query(
      `SELECT
         t.id, t.teacher_number, t.first_name, t.last_name,
         t.phone, t.gender, t.specialization, t.qualification,
         t.hire_date, t.is_active, t.photo_url, t.created_at,
         u.email,
         ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) AS subjects,
         COUNT(DISTINCT tc.class_id) AS class_count
       FROM teachers t
       LEFT JOIN users            u  ON u.id  = t.user_id
       LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
       LEFT JOIN subjects         s  ON s.id  = ts.subject_id
       LEFT JOIN teacher_classes  tc ON tc.teacher_id = t.id
       ${where}
       GROUP BY t.id, u.email
       ORDER BY t.created_at DESC`,
      params
    );

    return sendSuccess(res, rows, `Found ${rows.length} teacher(s).`);

  } catch (err) {
    console.error('getTeachers error:', err);
    return sendError(res, 'Server error while fetching teachers.', 500);
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
      `SELECT s.id, s.name, s.code FROM subjects s
       JOIN teacher_subjects ts ON ts.subject_id = s.id
       WHERE ts.teacher_id = $1`, [id]
    );

    const { rows: classes } = await db.query(
      `SELECT c.id, c.name, c.grade_level, c.section, s.name AS subject_name
       FROM teacher_classes tc
       JOIN classes  c ON c.id = tc.class_id
       JOIN subjects s ON s.id = tc.subject_id
       WHERE tc.teacher_id = $1 ORDER BY c.grade_level, c.section`, [id]
    );

    teacher.subjects = subjects;
    teacher.classes  = classes;

    return sendSuccess(res, teacher, 'Teacher profile retrieved.');

  } catch (err) {
    console.error('getTeacherById error:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── PUT /api/teachers/:id ────────────────────────────────────
const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, phone, gender,
            specialization, qualification, hire_date, is_active } = req.body;

    const { rows } = await db.query(
      `UPDATE teachers SET
         first_name     = COALESCE($1, first_name),
         last_name      = COALESCE($2, last_name),
         phone          = COALESCE($3, phone),
         gender         = COALESCE($4, gender),
         specialization = COALESCE($5, specialization),
         qualification  = COALESCE($6, qualification),
         hire_date      = COALESCE($7, hire_date),
         is_active      = COALESCE($8, is_active),
         updated_at     = NOW()
       WHERE id = $9 RETURNING *`,
      [first_name, last_name, phone, gender,
       specialization, qualification, hire_date, is_active, id]
    );
    if (!rows[0]) return sendError(res, 'Teacher not found.', 404);
    return sendSuccess(res, rows[0], 'Teacher updated.');

  } catch (err) {
    console.error('updateTeacher error:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── POST /api/teachers/:id/subjects ──────────────────────────
const assignSubjects = async (req, res) => {
  try {
    const { id }          = req.params;
    const { subject_ids } = req.body;

    if (!subject_ids || !Array.isArray(subject_ids)) {
      return sendError(res, 'subject_ids array is required.', 400);
    }

    await db.query('DELETE FROM teacher_subjects WHERE teacher_id = $1', [id]);
    for (const sid of subject_ids) {
      await db.query(
        `INSERT INTO teacher_subjects (teacher_id, subject_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, sid]
      );
    }
    return sendSuccess(res, null, `${subject_ids.length} subject(s) assigned.`);

  } catch (err) {
    console.error('assignSubjects error:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── POST /api/teachers/:id/classes ───────────────────────────
const assignClass = async (req, res) => {
  try {
    const { id }               = req.params;
    const { class_id, subject_id } = req.body;

    if (!class_id || !subject_id) {
      return sendError(res, 'class_id and subject_id are required.', 400);
    }

    await db.query(
      `INSERT INTO teacher_classes (teacher_id, class_id, subject_id)
       VALUES ($1,$2,$3) ON CONFLICT (teacher_id, class_id, subject_id) DO NOTHING`,
      [id, class_id, subject_id]
    );
    return sendSuccess(res, null, 'Teacher assigned to class.');

  } catch (err) {
    console.error('assignClass error:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/teachers/subjects ───────────────────────────────
const getAllSubjects = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, code FROM subjects ORDER BY name'
    );
    return sendSuccess(res, rows, `${rows.length} subject(s) found.`);
  } catch (err) {
    return sendError(res, 'Server error.', 500);
  }
};


module.exports = {
  createTeacher, getTeachers, getTeacherById,
  updateTeacher, assignSubjects, assignClass, getAllSubjects,
};
