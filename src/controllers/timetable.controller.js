// src/controllers/timetable.controller.js
// ============================================================
// Handles all timetable operations:
//   POST /api/timetable              → create a timetable slot
//   GET  /api/timetable/class/:id    → get timetable for a class
//   GET  /api/timetable/teacher/:id  → get timetable for a teacher
//   PUT  /api/timetable/:id          → update a slot
//   DELETE /api/timetable/:id        → remove a slot
//   GET  /api/timetable/classes      → list all classes
// ============================================================

const db            = require('../config/db');
const { sendSuccess,
        sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');

// Days and periods config
const DAYS    = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const PERIODS = [1,2,3,4,5,6,7,8];

// ── POST /api/timetable ──────────────────────────────────────
// Create one timetable slot (class + subject + teacher + day + period)
const createSlot = async (req, res) => {
  try {
    const {
      class_id,
      subject_id,
      teacher_id,
      day,
      period,
      start_time,
      end_time,
      room,
    } = req.body;

    if (!class_id || !subject_id || !day || !period || !start_time || !end_time) {
      return sendError(res,
        'class_id, subject_id, day, period, start_time, end_time are required.', 400);
    }

    if (!DAYS.includes(day)) {
      return sendError(res, `day must be one of: ${DAYS.join(', ')}`, 400);
    }

    if (!PERIODS.includes(parseInt(period))) {
      return sendError(res, `period must be between 1 and 8.`, 400);
    }

    // Check for conflict — same class, same day, same period
    const { rows: conflict } = await db.query(
      `SELECT id FROM timetable
       WHERE class_id = $1 AND day = $2 AND period = $3`,
      [class_id, day, parseInt(period)]
    );

    if (conflict[0]) {
      return sendError(res,
        `Conflict: This class already has a slot on ${day} period ${period}.`, 409);
    }

    // Check teacher conflict — same teacher, same day, same period
    if (teacher_id) {
      const { rows: teacherConflict } = await db.query(
        `SELECT id FROM timetable
         WHERE teacher_id = $1 AND day = $2 AND period = $3`,
        [teacher_id, day, parseInt(period)]
      );

      if (teacherConflict[0]) {
        return sendError(res,
          `Teacher conflict: This teacher already has a class on ${day} period ${period}.`, 409);
      }
    }

    const { rows } = await db.query(
      `INSERT INTO timetable
         (class_id, subject_id, teacher_id, day, period, start_time, end_time, room)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        class_id, subject_id,
        teacher_id || null,
        day, parseInt(period),
        start_time, end_time,
        room?.trim() || null,
      ]
    );

    return sendSuccess(res, rows[0], `Timetable slot created for ${day} period ${period}.`, 201);

  } catch (err) {
    return sendServerError(res, err, 'Server error while creating timetable slot.');
  }
};


// ── GET /api/timetable/class/:classId ────────────────────────
// Get full weekly timetable for a class — organized by day.
const getClassTimetable = async (req, res) => {
  try {
    const { classId } = req.params;

    // Get class info first
    const { rows: classRows } = await db.query(
      `SELECT c.*, ay.name AS academic_year
       FROM classes c
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE c.id = $1`,
      [classId]
    );

    if (!classRows[0]) {
      return sendError(res, 'Class not found.', 404);
    }

    // Get all timetable slots for this class
    const { rows } = await db.query(
      `SELECT
         t.id, t.day, t.period, t.start_time, t.end_time, t.room,
         s.name  AS subject_name,
         s.code  AS subject_code,
         te.first_name || ' ' || te.last_name AS teacher_name,
         te.id   AS teacher_id
       FROM timetable t
       LEFT JOIN subjects s  ON s.id  = t.subject_id
       LEFT JOIN teachers te ON te.id = t.teacher_id
       WHERE t.class_id = $1
       ORDER BY
         CASE t.day
           WHEN 'Monday'    THEN 1
           WHEN 'Tuesday'   THEN 2
           WHEN 'Wednesday' THEN 3
           WHEN 'Thursday'  THEN 4
           WHEN 'Friday'    THEN 5
           WHEN 'Saturday'  THEN 6
         END,
         t.period`,
      [classId]
    );

    // Organize by day
    const byDay = {};
    DAYS.forEach(d => { byDay[d] = []; });
    rows.forEach(slot => {
      if (byDay[slot.day]) byDay[slot.day].push(slot);
    });

    return sendSuccess(res, {
      class:    classRows[0],
      total_slots: rows.length,
      by_day:   byDay,
      all_slots: rows,
    }, `Timetable for ${classRows[0].name}.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching timetable.');
  }
};


// ── GET /api/timetable/teacher/:teacherId ────────────────────
// Get a teacher's full weekly schedule.
const getTeacherTimetable = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const { rows } = await db.query(
      `SELECT
         t.id, t.day, t.period, t.start_time, t.end_time, t.room,
         s.name  AS subject_name,
         c.name  AS class_name,
         c.grade_level, c.section
       FROM timetable t
       LEFT JOIN subjects s ON s.id = t.subject_id
       LEFT JOIN classes  c ON c.id = t.class_id
       WHERE t.teacher_id = $1
       ORDER BY
         CASE t.day
           WHEN 'Monday'    THEN 1
           WHEN 'Tuesday'   THEN 2
           WHEN 'Wednesday' THEN 3
           WHEN 'Thursday'  THEN 4
           WHEN 'Friday'    THEN 5
           WHEN 'Saturday'  THEN 6
         END,
         t.period`,
      [teacherId]
    );

    // Organize by day
    const byDay = {};
    DAYS.forEach(d => { byDay[d] = []; });
    rows.forEach(slot => {
      if (byDay[slot.day]) byDay[slot.day].push(slot);
    });

    return sendSuccess(res, {
      total_slots: rows.length,
      by_day:      byDay,
      all_slots:   rows,
    }, `Teacher schedule loaded.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── PUT /api/timetable/:id ───────────────────────────────────
const updateSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const { subject_id, teacher_id, day, period, start_time, end_time, room } = req.body;

    const { rows } = await db.query(
      `UPDATE timetable SET
         subject_id = COALESCE($1, subject_id),
         teacher_id = COALESCE($2, teacher_id),
         day        = COALESCE($3, day),
         period     = COALESCE($4, period),
         start_time = COALESCE($5, start_time),
         end_time   = COALESCE($6, end_time),
         room       = COALESCE($7, room)
       WHERE id = $8
       RETURNING *`,
      [subject_id, teacher_id, day, period, start_time, end_time, room, id]
    );

    if (!rows[0]) return sendError(res, 'Slot not found.', 404);
    return sendSuccess(res, rows[0], 'Timetable slot updated.');

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── DELETE /api/timetable/:id ────────────────────────────────
const deleteSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      'DELETE FROM timetable WHERE id = $1 RETURNING id', [id]
    );
    if (!rows[0]) return sendError(res, 'Slot not found.', 404);
    return sendSuccess(res, null, 'Timetable slot removed.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/timetable/classes ───────────────────────────────
// List all classes (for dropdown in timetable builder)
const getClasses = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.grade_level, c.section,
              t.first_name || ' ' || t.last_name AS homeroom_teacher
       FROM classes c
       LEFT JOIN teachers t ON t.id = c.homeroom_teacher_id
       ORDER BY c.grade_level, c.section`
    );
    return sendSuccess(res, rows, `${rows.length} class(es) found.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/timetable/subjects ──────────────────────────────
const getSubjects = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, code FROM subjects ORDER BY name'
    );
    return sendSuccess(res, rows, `${rows.length} subject(s) found.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


module.exports = {
  createSlot,
  getClassTimetable,
  getTeacherTimetable,
  updateSlot,
  deleteSlot,
  getClasses,
  getSubjects,
};
