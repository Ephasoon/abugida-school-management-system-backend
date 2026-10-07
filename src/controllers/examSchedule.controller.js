// src/controllers/examSchedule.controller.js
// ============================================================
// Handles exam scheduling operations:
//   POST /api/exam-schedule              → schedule an exam
//   GET  /api/exam-schedule              → list all scheduled exams
//   GET  /api/exam-schedule/:id          → get one scheduled exam
//   PUT  /api/exam-schedule/:id          → update schedule
//   DELETE /api/exam-schedule/:id        → cancel exam
//   GET  /api/exam-schedule/class/:id    → exams for a class
//   GET  /api/exam-schedule/upcoming     → upcoming exams (next 30 days)
//   GET  /api/exam-schedule/calendar     → calendar view data
// ============================================================

const db            = require('../config/db');
const { sendSuccess,
        sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { validateMaxScore, isScoreRuleViolation } = require('../utils/examRules');
const { scopeCondition } = require('../utils/scope');
const { createExam, ExamError } = require('../services/exam.service');


// ── POST /api/exam-schedule ──────────────────────────────────
const scheduleExam = async (req, res) => {
  // Admin: any class. Teacher: own class + subject only (services/exam.service.js).
  try {
    const { exam, schedule, className, subjectName } =
      await createExam(req.user, req.body, { requireDate: true });
    return sendSuccess(res, {
      ...exam,
      class_name:   className,
      subject_name: subjectName,
      room:         schedule?.room ?? null,
      start_time:   schedule?.start_time ?? null,
      end_time:     schedule?.end_time ?? null,
      instructions: schedule?.instructions ?? null,
    }, `Exam "${exam.name}" scheduled for ${exam.exam_date}.`, 201);
  } catch (err) {
    if (err instanceof ExamError) return sendError(res, err.message, err.status, err.errors);
    return sendServerError(res, err, 'Server error while scheduling exam.');
  }
};


// ── GET /api/exam-schedule ───────────────────────────────────
const getAllScheduled = async (req, res) => {
  try {
    const { term, class_id, from_date, to_date } = req.query;

    const conditions = ['e.exam_date IS NOT NULL'];
    const params     = [];
    let   idx        = 1;

    if (term)      { conditions.push(`e.term = $${idx++}`);       params.push(term); }
    if (class_id)  { conditions.push(`e.class_id = $${idx++}`);   params.push(class_id); }
    if (from_date) { conditions.push(`e.exam_date >= $${idx++}`);  params.push(from_date); }
    if (to_date)   { conditions.push(`e.exam_date <= $${idx++}`);  params.push(to_date); }
    // Only classes the user may see (teacher: own; student/parent: own or children's)
    const scoped = await scopeCondition(req.user, 'e.class_id', params);
    if (scoped) { conditions.push(scoped); idx = params.length + 1; }

    const where = 'WHERE ' + conditions.join(' AND ');

    const { rows } = await db.query(
      `SELECT
         e.id, e.name, e.exam_type, e.term,
         e.exam_date, e.max_score, e.created_at,
         c.name        AS class_name,
         c.grade_level,
         c.section,
         s.name        AS subject_name,
         s.code        AS subject_code,
         ay.name       AS academic_year,
         COUNT(g.id)   AS grades_entered
       FROM exams e
       LEFT JOIN classes       c  ON c.id  = e.class_id
       LEFT JOIN subjects      s  ON s.id  = e.subject_id
       LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
       LEFT JOIN grades        g  ON g.exam_id = e.id
       ${where}
       GROUP BY e.id, c.name, c.grade_level, c.section,
                s.name, s.code, ay.name
       ORDER BY e.exam_date ASC, c.grade_level`,
      params
    );

    return sendSuccess(res, rows, `Found ${rows.length} scheduled exam(s).`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/exam-schedule/upcoming ──────────────────────────
const getUpcoming = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const params = [parseInt(days)];
    const scoped = await scopeCondition(req.user, 'e.class_id', params);

    const { rows } = await db.query(
      `SELECT
         e.id, e.name, e.exam_type, e.term,
         e.exam_date, e.max_score,
         c.name        AS class_name,
         c.grade_level, c.section,
         s.name        AS subject_name,
         s.code        AS subject_code,
         -- Days until exam
         (e.exam_date - CURRENT_DATE) AS days_until
       FROM exams e
       LEFT JOIN classes  c ON c.id = e.class_id
       LEFT JOIN subjects s ON s.id = e.subject_id
       WHERE e.exam_date >= CURRENT_DATE
         AND e.exam_date <= CURRENT_DATE + $1::int
         ${scoped ? 'AND ' + scoped : ''}
       ORDER BY e.exam_date ASC
       LIMIT 50`,
      params
    );

    return sendSuccess(res, rows, `${rows.length} upcoming exam(s) in the next ${days} days.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/exam-schedule/calendar ──────────────────────────
// Returns data grouped by date for a calendar view.
const getCalendar = async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year  || new Date().getFullYear();
    const params = [m, y];
    const scoped = await scopeCondition(req.user, 'e.class_id', params);

    const { rows } = await db.query(
      `SELECT
         e.id, e.name, e.exam_type, e.term, e.exam_date, e.max_score,
         c.name        AS class_name,
         c.grade_level,
         s.name        AS subject_name,
         s.code        AS subject_code
       FROM exams e
       LEFT JOIN classes  c ON c.id = e.class_id
       LEFT JOIN subjects s ON s.id = e.subject_id
       WHERE EXTRACT(MONTH FROM e.exam_date) = $1
         AND EXTRACT(YEAR  FROM e.exam_date) = $2
         ${scoped ? 'AND ' + scoped : ''}
       ORDER BY e.exam_date ASC`,
      params
    );

    // Group by date
    const byDate = {};
    rows.forEach(exam => {
      const dateKey = exam.exam_date; // already 'YYYY-MM-DD' (see config/db.js)
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(exam);
    });

    return sendSuccess(res, {
      month: parseInt(m),
      year:  parseInt(y),
      total: rows.length,
      by_date: byDate,
      all_exams: rows,
    }, `Calendar for ${m}/${y}.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/exam-schedule/class/:classId ────────────────────
const getClassExams = async (req, res) => {
  try {
    const { classId } = req.params;
    const { term }    = req.query;

    const params     = [classId];
    let   termFilter = '';
    if (term) { termFilter = 'AND e.term = $2'; params.push(term); }

    const { rows } = await db.query(
      `SELECT
         e.id, e.name, e.exam_type, e.term,
         e.exam_date, e.max_score, e.created_at,
         s.name AS subject_name, s.code AS subject_code,
         COUNT(g.id) AS grades_entered,
         (e.exam_date - CURRENT_DATE) AS days_until
       FROM exams e
       LEFT JOIN subjects s ON s.id  = e.subject_id
       LEFT JOIN grades   g ON g.exam_id = e.id
       WHERE e.class_id = $1 ${termFilter}
       GROUP BY e.id, s.name, s.code
       ORDER BY e.exam_date ASC NULLS LAST`,
      params
    );

    return sendSuccess(res, rows, `Found ${rows.length} exam(s) for this class.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── PUT /api/exam-schedule/:id ───────────────────────────────
const updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, exam_date, exam_type, term, max_score, room, start_time, end_time } = req.body;

    const maxScoreError = validateMaxScore(max_score);
    if (maxScoreError) return sendError(res, maxScoreError, 400);

    const { rows } = await db.query(
      `UPDATE exams SET
         name      = COALESCE($1, name),
         exam_date = COALESCE($2, exam_date),
         exam_type = COALESCE($3, exam_type),
         term      = COALESCE($4, term),
         max_score = COALESCE($5, max_score)
       WHERE id = $6 RETURNING *`,
      [name, exam_date, exam_type, term, max_score, id]
    );

    if (!rows[0]) return sendError(res, 'Exam not found.', 404);
    return sendSuccess(res, rows[0], 'Exam schedule updated.');

  } catch (err) {
    if (isScoreRuleViolation(err)) {
      return sendError(res, 'max_score cannot be lower than a score already entered for this exam.', 400);
    }
    return sendServerError(res, err, 'Server error.');
  }
};


// ── DELETE /api/exam-schedule/:id ────────────────────────────
const cancelExam = async (req, res) => {
  try {
    const { id } = req.params;

    // Only cancel if no grades entered
    const { rows: gradeCheck } = await db.query(
      'SELECT COUNT(*) FROM grades WHERE exam_id = $1', [id]
    );
    if (parseInt(gradeCheck[0].count) > 0) {
      return sendError(res,
        'Cannot cancel exam with grades already entered. Remove grades first.', 400);
    }

    const { rows } = await db.query(
      'DELETE FROM exams WHERE id = $1 RETURNING name', [id]
    );
    if (!rows[0]) return sendError(res, 'Exam not found.', 404);

    return sendSuccess(res, null, `Exam "${rows[0].name}" cancelled.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


module.exports = {
  scheduleExam,
  getAllScheduled,
  getUpcoming,
  getCalendar,
  getClassExams,
  updateSchedule,
  cancelExam,
};
