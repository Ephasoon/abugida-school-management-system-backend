// src/controllers/attendance.controller.js
// ============================================================
// Handles all attendance operations:
//   POST /api/attendance              → mark class attendance (bulk)
//   GET  /api/attendance/:classId/:date → get attendance for a class on a date
//   PUT  /api/attendance/:id          → correct one entry
//   GET  /api/attendance/student/:id  → student's full history
//   GET  /api/attendance/report/:classId → monthly class report
// ============================================================

const db                 = require('../config/db');
const { sendSuccess,
        sendError }      = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');


// ── POST /api/attendance ─────────────────────────────────────
// Mark attendance for an entire class in one request.
// Body: { class_id, date, records: [{ student_id, status, note }] }
const markAttendance = async (req, res) => {
  const client = await db.pool.connect(); // Use a transaction
  try {
    const { class_id, date, records } = req.body;

    // Validate
    if (!class_id || !date || !records || !Array.isArray(records)) {
      return sendError(res, 'class_id, date, and records[] are required.', 400);
    }

    if (records.length === 0) {
      return sendError(res, 'records array cannot be empty.', 400);
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return sendError(res, 'date must be in YYYY-MM-DD format.', 400);
    }

    // Validate all statuses
    const validStatuses = ['present', 'absent', 'late', 'excused'];
    for (const r of records) {
      if (!r.student_id || !r.status) {
        return sendError(res, 'Each record needs student_id and status.', 400);
      }
      if (!validStatuses.includes(r.status)) {
        return sendError(res, `Invalid status "${r.status}". Use: ${validStatuses.join(', ')}`, 400);
      }
    }

    // Get teacher id from users table (if role is teacher)
    let teacher_id = null;
    if (req.user.role === 'teacher') {
      const { rows } = await db.query(
        'SELECT id FROM teachers WHERE user_id = $1', [req.user.id]
      );
      teacher_id = rows[0]?.id || null;

      // The route already checked the class is the teacher's own;
      // every student must also be in that class.
      const ids = records.map(r => String(r.student_id));
      const { rows: inClass } = await db.query(
        'SELECT id FROM students WHERE class_id = $1 AND id::text = ANY($2)', [class_id, ids]);
      const allowed = new Set(inClass.map(r => r.id));
      const outside = ids.filter(id => !allowed.has(id));
      if (outside.length) {
        return sendError(res, 'Some students are not in this class.', 403, { student_ids: outside });
      }
    }

    // Begin transaction — all records save together or none do
    await client.query('BEGIN');

    const saved    = [];
    const skipped  = [];

    for (const record of records) {
      // Use INSERT ... ON CONFLICT to handle re-marking
      // If attendance already exists for this student+date, UPDATE it
      const { rows } = await client.query(
        `INSERT INTO attendance (student_id, class_id, marked_by, date, status, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, date)
         DO UPDATE SET
           status     = EXCLUDED.status,
           note       = EXCLUDED.note,
           marked_by  = EXCLUDED.marked_by,
           updated_at = NOW()
         RETURNING *`,
        [
          record.student_id,
          class_id,
          teacher_id,
          date,
          record.status,
          record.note || null,
        ]
      );
      saved.push(rows[0]);
    }

    await client.query('COMMIT');

    // Count summary
    const summary = {
      present: saved.filter(r => r.status === 'present').length,
      absent:  saved.filter(r => r.status === 'absent').length,
      late:    saved.filter(r => r.status === 'late').length,
      excused: saved.filter(r => r.status === 'excused').length,
    };

    return sendSuccess(res, {
      date,
      class_id,
      total_marked: saved.length,
      summary,
      records: saved,
    }, `Attendance marked for ${saved.length} student(s) on ${date}.`, 201);

  } catch (err) {
    await client.query('ROLLBACK');
    return sendServerError(res, err, 'Server error while marking attendance.');
  } finally {
    client.release();
  }
};


// ── GET /api/attendance/:classId/:date ────────────────────────
// Get attendance for a specific class on a specific date.
// Returns all students in the class with their status.
const getClassAttendance = async (req, res) => {
  try {
    const { classId, date } = req.params;

    // Get all students in the class with their attendance for this date
    const { rows } = await db.query(
      `SELECT
         s.id            AS student_id,
         s.student_number,
         s.first_name,
         s.last_name,
         s.fathers_name,
         s.photo_url,
         a.id            AS attendance_id,
         a.status,
         a.note,
         a.sms_sent,
         a.updated_at    AS marked_at
       FROM students s
       LEFT JOIN attendance a
         ON a.student_id = s.id
         AND a.date = $2
       WHERE s.class_id = $1
         AND s.status   = 'active'
       ORDER BY s.first_name, s.last_name`,
      [classId, date]
    );

    if (rows.length === 0) {
      return sendError(res, 'No students found for this class.', 404);
    }

    // Summary counts
    const marked   = rows.filter(r => r.status !== null);
    const summary  = {
      total:   rows.length,
      marked:  marked.length,
      present: rows.filter(r => r.status === 'present').length,
      absent:  rows.filter(r => r.status === 'absent').length,
      late:    rows.filter(r => r.status === 'late').length,
      excused: rows.filter(r => r.status === 'excused').length,
    };

    return sendSuccess(res, {
      class_id: classId,
      date,
      summary,
      students: rows,
    }, `Attendance data for ${date}.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching attendance.');
  }
};


// ── PUT /api/attendance/:id ───────────────────────────────────
// Correct a single attendance entry (admin only).
const updateAttendance = async (req, res) => {
  try {
    const { id }             = req.params;
    const { status, note }   = req.body;

    const validStatuses = ['present', 'absent', 'late', 'excused'];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, `Invalid status. Use: ${validStatuses.join(', ')}`, 400);
    }

    const { rows } = await db.query(
      `UPDATE attendance
       SET
         status     = COALESCE($1, status),
         note       = COALESCE($2, note),
         updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, note, id]
    );

    if (!rows[0]) {
      return sendError(res, 'Attendance record not found.', 404);
    }

    return sendSuccess(res, rows[0], 'Attendance updated successfully.');

  } catch (err) {
    return sendServerError(res, err, 'Server error while updating attendance.');
  }
};


// ── GET /api/attendance/student/:studentId ────────────────────
// Get a student's full attendance history with monthly summary.
const getStudentAttendance = async (req, res) => {
  try {
    const { studentId }              = req.params;
    const { month, year } = req.query;
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);

    // Build date filter
    let dateFilter = '';
    const params   = [studentId];

    if (month && year) {
      dateFilter = `AND date_trunc('month', a.date) = $2`;
      params.push(`${year}-${String(month).padStart(2,'0')}-01`);
    } else if (year) {
      dateFilter = `AND EXTRACT(YEAR FROM a.date) = $2`;
      params.push(year);
    }

    // Get attendance records
    const { rows } = await db.query(
      `SELECT
         a.id, a.date, a.status, a.note, a.sms_sent,
         c.name AS class_name
       FROM attendance a
       LEFT JOIN classes c ON c.id = a.class_id
       WHERE a.student_id = $1
         ${dateFilter}
       ORDER BY a.date DESC
       LIMIT $${params.length + 1}`,
      [...params, pg.limit]
    );

    // Calculate overall stats
    const { rows: stats } = await db.query(
      `SELECT
         COUNT(*)                                         AS total_days,
         COUNT(*) FILTER (WHERE status = 'present')      AS present,
         COUNT(*) FILTER (WHERE status = 'absent')       AS absent,
         COUNT(*) FILTER (WHERE status = 'late')         AS late,
         COUNT(*) FILTER (WHERE status = 'excused')      AS excused,
         ROUND(
           COUNT(*) FILTER (WHERE status = 'present') * 100.0
           / NULLIF(COUNT(*), 0), 1
         )                                               AS attendance_rate
       FROM attendance a
       WHERE a.student_id = $1 ${dateFilter}`,
      params
    );

    return sendSuccess(res, {
      student_id: studentId,
      stats:      stats[0],
      records:    rows,
    }, 'Student attendance retrieved.');

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching student attendance.');
  }
};


// ── GET /api/attendance/report/:classId ──────────────────────
// Monthly attendance report for a whole class.
// Shows each student's attendance rate for the month.
const getClassReport = async (req, res) => {
  try {
    const { classId }          = req.params;
    const { month, year }      = req.query;

    const reportMonth = month || new Date().getMonth() + 1;
    const reportYear  = year  || new Date().getFullYear();

    const { rows } = await db.query(
      `SELECT
         s.student_number,
         s.first_name,
         s.last_name,
         COUNT(a.id)                                          AS total_days,
         COUNT(a.id) FILTER (WHERE a.status = 'present')     AS present,
         COUNT(a.id) FILTER (WHERE a.status = 'absent')      AS absent,
         COUNT(a.id) FILTER (WHERE a.status = 'late')        AS late,
         COUNT(a.id) FILTER (WHERE a.status = 'excused')     AS excused,
         ROUND(
           COUNT(a.id) FILTER (WHERE a.status = 'present') * 100.0
           / NULLIF(COUNT(a.id), 0), 1
         )                                                    AS attendance_rate
       FROM students s
       LEFT JOIN attendance a
         ON  a.student_id = s.id
         AND EXTRACT(MONTH FROM a.date) = $2
         AND EXTRACT(YEAR  FROM a.date) = $3
       WHERE s.class_id = $1
         AND s.status   = 'active'
       GROUP BY s.id, s.student_number, s.first_name, s.last_name
       ORDER BY attendance_rate DESC NULLS LAST`,
      [classId, reportMonth, reportYear]
    );

    // Class-wide summary
    const classStats = {
      total_students:      rows.length,
      avg_attendance_rate: rows.length
        ? (rows.reduce((sum, r) => sum + parseFloat(r.attendance_rate || 0), 0) / rows.length).toFixed(1)
        : 0,
      perfect_attendance:  rows.filter(r => parseFloat(r.attendance_rate) === 100).length,
      below_75_percent:    rows.filter(r => parseFloat(r.attendance_rate) < 75).length,
    };

    return sendSuccess(res, {
      class_id:   classId,
      month:      reportMonth,
      year:       reportYear,
      class_stats: classStats,
      students:   rows,
    }, `Monthly attendance report for ${reportMonth}/${reportYear}.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error while generating report.');
  }
};


module.exports = {
  markAttendance,
  getClassAttendance,
  updateAttendance,
  getStudentAttendance,
  getClassReport,
};
