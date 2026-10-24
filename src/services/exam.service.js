// src/services/exam.service.js
// ============================================================
// The single way an exam is created or changed. Used by:
//   POST /api/exam-schedule  (date required, schedule details)
//   PUT  /api/exam-schedule/:id (admin)
//
// Max scores (D25): one subject's assessments in one class and semester add up to at most 100.
// Checked inside the write's transaction under an advisory lock on (class, subject, semester),
// so two exams saved at the same moment can't pass it together.
//
// Semester (B1): an exam with a date gets the semester of that date, which must lie inside
// its class's academic year; `semester` sent with a date must agree with it. Without a date,
// `semester` (1|2) is required (the old `term` is refused). The exam's year is its class's.
//
// Rule (docs/PERMISSIONS.md, "Exams/grades enter"):
//   admin   → any class
//   teacher → only a class + subject assigned in teacher_classes
//   others  → never (routes reject them; checked here too)
// ============================================================

const db = require('../config/db');
const { validateMaxScore } = require('../utils/examRules');
const { TERM_GONE, parseSemester, semesterOfDate, semesterNumber } = require('../utils/semesters');
const { isIsoDate } = require('../utils/attendance');
const { inTransaction } = require('../utils/transaction');
const { LockedError, assertSemesterUnlocked } = require('./locks.service');

const EXAM_TYPES = ['quiz', 'midterm', 'final', 'assignment', 'project'];

class ExamError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}

// A class with its academic year (dates as 'YYYY-MM-DD'), or null
const loadClassYear = async (q, classId) => (await q.query(
  `SELECT c.id, c.name, c.academic_year_id, y.name AS year_name, y.start_date, y.end_date, y.semester2_start
   FROM classes c JOIN academic_years y ON y.id = c.academic_year_id WHERE c.id::text = $1`, [String(classId)])).rows[0] || null;

/**
 * The semester for an exam of a class in `year`.
 * { semester, term, exam_date } as sent; returns { semester } or throws ExamError (400).
 */
const decideSemester = (year, { semester, term, exam_date }) => {
  if (term !== undefined && term !== null && term !== '') throw new ExamError(400, TERM_GONE, { field: 'term' });
  const sent = parseSemester(semester);
  if (sent === null) throw new ExamError(400, 'semester must be 1 or 2.', { field: 'semester' });
  if (exam_date) {
    if (!isIsoDate(exam_date)) throw new ExamError(400, 'exam_date must be a real date in YYYY-MM-DD format.', { field: 'exam_date' });
    const byDate = semesterOfDate(year, exam_date);
    if (!byDate) {
      throw new ExamError(400, `exam_date must be inside the academic year ${year.year_name} (${year.start_date} to ${year.end_date}).`, { field: 'exam_date' });
    }
    if (sent && sent !== byDate) {
      throw new ExamError(400, `${exam_date} is in semester ${semesterNumber(byDate)} of ${year.year_name} (semester 2 starts ${year.semester2_start}), but semester ${semesterNumber(sent)} was sent.`, { field: 'semester' });
    }
    return { semester: byDate };
  }
  if (sent) return { semester: sent };
  throw new ExamError(400, 'semester (1 or 2) is required for an exam without a date.', { field: 'semester' });
};

const fmt = (n) => Number(Number(n).toFixed(2));

/** D29: refuse (409) a change to an exam of a locked semester. */
const assertUnlocked = async (client, cls, semester) => {
  try {
    await assertSemesterUnlocked(client, { classId: cls.id, yearId: cls.academic_year_id, semester, className: cls.name });
  } catch (err) {
    if (err instanceof LockedError) throw new ExamError(409, err.message, err.errors);
    throw err;
  }
};

/**
 * D25: refuse (400) when the subject's max scores in this class and semester would exceed 100.
 * Call inside the transaction that writes the exam; excludeExamId: the exam being edited.
 */
const assertMaxTotal = async (client, { cls, subjectId, subjectName, semester, maxScore, excludeExamId = null }) => {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`exam-max:${cls.id}:${subjectId}:${semester}`]);
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(max_score), 0) AS used FROM exams
     WHERE class_id = $1 AND subject_id = $2 AND semester = $3 AND ($4::uuid IS NULL OR id <> $4)`,
    [cls.id, subjectId, semester, excludeExamId]);
  const used = fmt(rows[0].used), total = fmt(used + Number(maxScore));
  if (total > 100) {
    throw new ExamError(400,
      `${subjectName}, ${cls.name}, semester ${semesterNumber(semester)}: max scores would total ${total} (already ${used} + this ${fmt(maxScore)}). The limit is 100.`,
      { field: 'max_score', used, remaining: fmt(Math.max(0, 100 - used)), limit: 100 });
  }
};

/**
 * createExam(user, input, { requireDate })
 * input: { class_id, subject_id, name, exam_type, semester?, max_score?, exam_date?,
 *          start_time?, end_time?, room?, instructions? }
 * Returns { exam, schedule, className, subjectName }; throws ExamError on invalid input.
 */
const createExam = async (user, input, { requireDate = false } = {}) => {
  const {
    class_id, subject_id, name, exam_type, semester, term,
    max_score = 100, exam_date, start_time, end_time, room, instructions,
  } = input;

  if (!['admin', 'teacher'].includes(user.role)) {
    throw new ExamError(403, 'Only admins and assigned teachers can create exams.');
  }

  // ── Validate input ──
  const required = { class_id, subject_id, name, exam_type, ...(requireDate ? { exam_date } : {}) };
  const missing = Object.keys(required).filter(k => !required[k] || (k === 'name' && !String(name).trim()));
  if (missing.length) throw new ExamError(400, `${Object.keys(required).join(', ')} are required.`, { missing });
  if (!EXAM_TYPES.includes(exam_type)) throw new ExamError(400, `exam_type must be: ${EXAM_TYPES.join(', ')}`);
  const maxScoreError = validateMaxScore(max_score);
  if (maxScoreError) throw new ExamError(400, maxScoreError);
  if (start_time && end_time && end_time <= start_time) throw new ExamError(400, 'end_time must be after start_time.');

  const cls = await loadClassYear(db, class_id);
  if (!cls) throw new ExamError(404, 'Class not found.');
  const { rows: sub } = await db.query('SELECT id, name, is_active FROM subjects WHERE id::text = $1', [String(subject_id)]);
  if (!sub[0]) throw new ExamError(404, 'Subject not found.');

  // ── Permission: teachers only for their own class + subject ──
  let createdBy = null;
  if (user.role === 'teacher') {
    const { rows } = await db.query(
      `SELECT t.id FROM teachers t
       JOIN teacher_classes tc ON tc.teacher_id = t.id
       WHERE t.user_id = $1 AND tc.class_id = $2 AND tc.subject_id = $3`,
      [user.id, cls.id, sub[0].id]);
    if (!rows[0]) throw new ExamError(403, 'Access denied. You are not assigned to teach this subject in this class.');
    createdBy = rows[0].id;
  }
  if (!sub[0].is_active) throw new ExamError(400, `subject_id: ${sub[0].name} is inactive.`, { field: 'subject_id' });
  const sem = decideSemester(cls, { semester, term, exam_date });   // after the access check: 403 first

  // ── Same class, same date: only one timed exam ──
  if (exam_date && start_time && end_time) {
    const { rows: conflict } = await db.query(
      'SELECT name FROM exams WHERE class_id = $1 AND exam_date = $2', [cls.id, exam_date]);
    if (conflict[0]) {
      throw new ExamError(409, `Conflict: ${cls.name} already has "${conflict[0].name}" scheduled on ${exam_date}.`);
    }
  }

  // ── Insert exam (+ schedule details) in one transaction ──
  const hasSchedule = !!(start_time || end_time || room || instructions);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await assertUnlocked(client, cls, sem.semester);
    await assertMaxTotal(client, { cls, subjectId: sub[0].id, subjectName: sub[0].name, semester: sem.semester, maxScore: max_score });
    const { rows: exam } = await client.query(
      `INSERT INTO exams
         (class_id, subject_id, academic_year_id, name, exam_type, semester, max_score, exam_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [cls.id, sub[0].id, cls.academic_year_id, String(name).trim(), exam_type, sem.semester,
       parseFloat(max_score), exam_date || null, createdBy]);

    let schedule = null;
    if (hasSchedule) {
      ({ rows: [schedule] } = await client.query(
        `INSERT INTO exam_schedules (exam_id, start_time, end_time, room, instructions)
         VALUES ($1,$2,$3,$4,$5) RETURNING start_time, end_time, room, instructions`,
        [exam[0].id, start_time || null, end_time || null, room?.trim() || null, instructions?.trim() || null]));
    }
    await client.query('COMMIT');
    return { exam: exam[0], schedule, className: cls.name, subjectName: sub[0].name };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * updateExam(id, input): PUT /exam-schedule/:id (admin).
 * input: { name?, exam_type?, exam_date?, semester?, max_score? }
 * A new date or semester is checked like on create. Returns the exam row.
 */
const updateExam = async (id, input) => {
  const { name, exam_type, exam_date, semester, term, max_score } = input;
  const maxScoreError = validateMaxScore(max_score);
  if (maxScoreError) throw new ExamError(400, maxScoreError);
  if (exam_type !== undefined && !EXAM_TYPES.includes(exam_type)) throw new ExamError(400, `exam_type must be: ${EXAM_TYPES.join(', ')}`);
  if (name !== undefined && !String(name).trim()) throw new ExamError(400, 'name cannot be empty.');

  const { rows: cur } = await db.query('SELECT * FROM exams WHERE id::text = $1', [String(id)]);
  if (!cur[0]) throw new ExamError(404, 'Exam not found.');
  const cls = await loadClassYear(db, cur[0].class_id);
  let sem = { semester: cur[0].semester };
  if (exam_date !== undefined || semester !== undefined || term !== undefined) {
    sem = decideSemester(cls, { semester, term, exam_date: exam_date ?? cur[0].exam_date });
  }
  const subjectName = (await db.query('SELECT name FROM subjects WHERE id = $1', [cur[0].subject_id])).rows[0]?.name ?? 'Subject';

  return inTransaction(async (client) => {
    await assertUnlocked(client, cls, cur[0].semester);
    if (sem.semester !== cur[0].semester) await assertUnlocked(client, cls, sem.semester);
    if (max_score !== undefined || sem.semester !== cur[0].semester) {
      await assertMaxTotal(client, { cls, subjectId: cur[0].subject_id, subjectName, semester: sem.semester,
        maxScore: max_score ?? cur[0].max_score, excludeExamId: cur[0].id });
    }
    const { rows } = await client.query(
      `UPDATE exams SET
         name      = COALESCE($1, name),
         exam_date = COALESCE($2, exam_date),
         exam_type = COALESCE($3, exam_type),
         semester  = $4,
         max_score = COALESCE($5, max_score)
       WHERE id = $6 RETURNING *`,
      [name === undefined ? null : String(name).trim(), exam_date ?? null, exam_type ?? null, sem.semester, max_score ?? null, cur[0].id]);
    return rows[0];
  });
};

module.exports = { createExam, updateExam, decideSemester, loadClassYear, assertMaxTotal, assertUnlocked, ExamError, EXAM_TYPES };
