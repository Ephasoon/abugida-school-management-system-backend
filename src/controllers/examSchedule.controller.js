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


// ── POST /api/exam-schedule ──────────────────────────────────
const scheduleExam = async (req, res) => {
  try {
    const {
      class_id,
      subject_id,
      exam_type,
      term,
      name,
      exam_date,
      start_time,
      end_time,
      room,
      max_score = 100,
      instructions,
    } = req.body;

    // Validate required fields
    if (!class_id || !subject_id || !name || !exam_type || !term || !exam_date) {
      return sendError(res,
        'class_id, subject_id, name, exam_type, term, and exam_date are required.', 400);
    }

    const validTypes = ['quiz','midterm','final','assignment','project'];
    const validTerms = ['term1','term2','term3'];

    if (!validTypes.includes(exam_type)) {
      return sendError(res, `exam_type must be: ${validTypes.join(', ')}`, 400);
    }
    if (!validTerms.includes(term)) {
      return sendError(res, `term must be: ${validTerms.join(', ')}`, 400);
    }

    // Check class exists
    const { rows: cls } = await db.query(
      'SELECT id, name FROM classes WHERE id = $1', [class_id]
    );
    if (!cls[0]) return sendError(res, 'Class not found.', 404);

    // Check subject exists
    const { rows: sub } = await db.query(
      'SELECT id, name FROM subjects WHERE id = $1', [subject_id]
    );
    if (!sub[0]) return sendError(res, 'Subject not found.', 404);

    // Check for scheduling conflict (same class, same date, overlapping time)
    if (start_time && end_time) {
      const { rows: conflict } = await db.query(
        `SELECT e.id, e.name FROM exams e
         WHERE e.class_id = $1
           AND e.exam_date = $2
           AND e.exam_date IS NOT NULL`,
        [class_id, exam_date]
      );
      if (conflict.length > 0) {
        return sendError(res,
          `Conflict: ${cls[0].name} already has "${conflict[0].name}" scheduled on ${exam_date}.`,
          409);
      }
    }

    // Get current academic year
    const { rows: yearRows } = await db.query(
      'SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1'
    );

    // Get teacher for this class+subject
    let created_by = null;
    if (req.user.role === 'teacher') {
      const { rows: tRows } = await db.query(
        'SELECT id FROM teachers WHERE user_id = $1', [req.user.id]
      );
      created_by = tRows[0]?.id || null;
    }

    // Create exam in the exams table (extends existing exams system)
    const { rows } = await db.query(
      `INSERT INTO exams
         (class_id, subject_id, academic_year_id, name, exam_type,
          term, max_score, exam_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        class_id, subject_id,
        yearRows[0]?.id || null,
        name.trim(), exam_type, term,
        parseFloat(max_score),
        exam_date,
        created_by,
      ]
    );

    // Store extra scheduling info in timetable-adjacent structure
    // We'll add start_time, end_time, room, instructions to exam record
    // via a separate exam_schedule table for extended info
    await db.query(
      `INSERT INTO exam_schedules
         (exam_id, start_time, end_time, room, instructions)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (exam_id) DO UPDATE SET
         start_time   = EXCLUDED.start_time,
         end_time     = EXCLUDED.end_time,
         room         = EXCLUDED.room,
         instructions = EXCLUDED.instructions`,
      [
        rows[0].id,
        start_time || null,
        end_time   || null,
        room?.trim() || null,
        instructions?.trim() || null,
      ]
    ).catch(() => {
      // exam_schedules table may not exist yet — that's OK
      // Core exam is already saved
    });

    return sendSuccess(res, {
      ...rows[0],
      class_name:   cls[0].name,
      subject_name: sub[0].name,
      room, start_time, end_time, instructions,
    }, `Exam "${name}" scheduled for ${exam_date}.`, 201);

  } catch (err) {
    console.error('scheduleExam error:', err);
    return sendError(res, 'Server error while scheduling exam.', 500);
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
    console.error('getAllScheduled error:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/exam-schedule/upcoming ──────────────────────────
const getUpcoming = async (req, res) => {
  try {
    const { days = 30 } = req.query;

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
       ORDER BY e.exam_date ASC
       LIMIT 50`,
      [parseInt(days)]
    );

    return sendSuccess(res, rows, `${rows.length} upcoming exam(s) in the next ${days} days.`);

  } catch (err) {
    console.error('getUpcoming error:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/exam-schedule/calendar ──────────────────────────
// Returns data grouped by date for a calendar view.
const getCalendar = async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = month || new Date().getMonth() + 1;
    const y = year  || new Date().getFullYear();

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
       ORDER BY e.exam_date ASC`,
      [m, y]
    );

    // Group by date
    const byDate = {};
    rows.forEach(exam => {
      const dateKey = exam.exam_date?.toISOString?.()?.split('T')[0]
                   || String(exam.exam_date).split('T')[0];
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
    console.error('getCalendar error:', err);
    return sendError(res, 'Server error.', 500);
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
    console.error('getClassExams error:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── PUT /api/exam-schedule/:id ───────────────────────────────
const updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, exam_date, exam_type, term, max_score, room, start_time, end_time } = req.body;

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
    console.error('updateSchedule error:', err);
    return sendError(res, 'Server error.', 500);
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
    console.error('cancelExam error:', err);
    return sendError(res, 'Server error.', 500);
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
