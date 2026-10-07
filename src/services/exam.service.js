// src/services/exam.service.js
// ============================================================
// The single way an exam is created. Used by:
//   POST /api/exam-schedule  (preferred: date required, schedule details)
//   POST /api/grades/exams   (deprecated alias: date optional)
//
// Rule (docs/PERMISSIONS.md, "Exams/grades enter"):
//   admin   → any class
//   teacher → only a class + subject assigned in teacher_classes
//   others  → never (routes reject them; checked here too)
// ============================================================

const db = require('../config/db');
const { validateMaxScore } = require('../utils/examRules');

const EXAM_TYPES = ['quiz', 'midterm', 'final', 'assignment', 'project'];
const TERMS      = ['term1', 'term2', 'term3'];

class ExamError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}

/**
 * createExam(user, input, { requireDate })
 * input: { class_id, subject_id, name, exam_type, term, max_score?, exam_date?,
 *          start_time?, end_time?, room?, instructions? }
 * Returns { exam, schedule, className, subjectName }; throws ExamError on invalid input.
 */
const createExam = async (user, input, { requireDate = false } = {}) => {
  const {
    class_id, subject_id, name, exam_type, term,
    max_score = 100, exam_date, start_time, end_time, room, instructions,
  } = input;

  if (!['admin', 'teacher'].includes(user.role)) {
    throw new ExamError(403, 'Only admins and assigned teachers can create exams.');
  }

  // ── Validate input ──
  const required = { class_id, subject_id, name, exam_type, term, ...(requireDate ? { exam_date } : {}) };
  const missing = Object.keys(required).filter(k => !required[k] || (k === 'name' && !String(name).trim()));
  if (missing.length) throw new ExamError(400, `${Object.keys(required).join(', ')} are required.`, { missing });
  if (!EXAM_TYPES.includes(exam_type)) throw new ExamError(400, `exam_type must be: ${EXAM_TYPES.join(', ')}`);
  if (!TERMS.includes(term))           throw new ExamError(400, `term must be: ${TERMS.join(', ')}`);
  const maxScoreError = validateMaxScore(max_score);
  if (maxScoreError) throw new ExamError(400, maxScoreError);
  if (exam_date && !/^\d{4}-\d{2}-\d{2}$/.test(exam_date)) throw new ExamError(400, 'exam_date must be YYYY-MM-DD.');
  if (start_time && end_time && end_time <= start_time) throw new ExamError(400, 'end_time must be after start_time.');

  const { rows: cls } = await db.query('SELECT id, name FROM classes WHERE id::text = $1', [String(class_id)]);
  if (!cls[0]) throw new ExamError(404, 'Class not found.');
  const { rows: sub } = await db.query('SELECT id, name FROM subjects WHERE id::text = $1', [String(subject_id)]);
  if (!sub[0]) throw new ExamError(404, 'Subject not found.');

  const { rows: year } = await db.query('SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1');
  if (!year[0]) throw new ExamError(400, 'No active academic year found. Please activate an academic year first.');

  // ── Permission: teachers only for their own class + subject ──
  let createdBy = null;
  if (user.role === 'teacher') {
    const { rows } = await db.query(
      `SELECT t.id FROM teachers t
       JOIN teacher_classes tc ON tc.teacher_id = t.id
       WHERE t.user_id = $1 AND tc.class_id = $2 AND tc.subject_id = $3`,
      [user.id, cls[0].id, sub[0].id]);
    if (!rows[0]) throw new ExamError(403, 'Access denied. You are not assigned to teach this subject in this class.');
    createdBy = rows[0].id;
  }

  // ── Same class, same date: only one timed exam ──
  if (exam_date && start_time && end_time) {
    const { rows: conflict } = await db.query(
      'SELECT name FROM exams WHERE class_id = $1 AND exam_date = $2', [cls[0].id, exam_date]);
    if (conflict[0]) {
      throw new ExamError(409, `Conflict: ${cls[0].name} already has "${conflict[0].name}" scheduled on ${exam_date}.`);
    }
  }

  // ── Insert exam (+ schedule details) in one transaction ──
  const hasSchedule = !!(start_time || end_time || room || instructions);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: exam } = await client.query(
      `INSERT INTO exams
         (class_id, subject_id, academic_year_id, name, exam_type, term, max_score, exam_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [cls[0].id, sub[0].id, year[0].id, String(name).trim(), exam_type, term,
       parseFloat(max_score), exam_date || null, createdBy]);

    let schedule = null;
    if (hasSchedule) {
      ({ rows: [schedule] } = await client.query(
        `INSERT INTO exam_schedules (exam_id, start_time, end_time, room, instructions)
         VALUES ($1,$2,$3,$4,$5) RETURNING start_time, end_time, room, instructions`,
        [exam[0].id, start_time || null, end_time || null, room?.trim() || null, instructions?.trim() || null]));
    }
    await client.query('COMMIT');
    return { exam: exam[0], schedule, className: cls[0].name, subjectName: sub[0].name };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { createExam, ExamError, EXAM_TYPES, TERMS };
