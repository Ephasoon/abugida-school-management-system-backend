// src/controllers/attendance.controller.js
// ============================================================
// Handles all attendance operations:
//   POST /api/attendance              → mark class attendance (bulk)
//   GET  /api/attendance/:classId/:date → get attendance for a class on a date
//   PUT  /api/attendance/:id          → correct one entry
//   GET  /api/attendance/student/:id  → student's full history
//   GET  /api/attendance/report/:classId → monthly class report
//
// Marking rules (M4):
//   - no future dates; the date must be inside the class's academic year
//   - teacher: own classes (route) of the current year, today and the previous 3 days
//   - admin: any class, any past date of its year; outside the teacher window it is audited
//   - one record per student per day: marking again updates it
//   - every student must belong to the class (now, or by an earlier record in it)
// Corrections (PUT) are admin only, need a reason and are audited.
// ============================================================

const db                 = require('../config/db');
const { sendSuccess,
        sendError }      = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const { audit }           = require('../utils/audit');
const { inTransaction }   = require('../utils/transaction');
const { STATUSES, TEACHER_WINDOW_DAYS, rateSql, isIsoDate, localDate, addDays, teacherWindow } = require('../utils/attendance');
const { LockedError, assertDateUnlocked } = require('../services/locks.service');
const RATE   = rateSql();   // attendance rate (M4): late attended, excused left out
const RATE_A = rateSql('a');   // attendance rate (M4): late attended, excused left out

const MAX_RECORDS = 500;
const MAX_TEXT    = 500;

// A class with its academic year, or null (also for a malformed id: compared as text)
const loadClass = async (classId) => (await db.query(
  `SELECT c.id, c.name, c.grade_level, c.section, c.academic_year_id,
          y.name AS year_name, y.start_date, y.end_date, y.is_current
   FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
   WHERE c.id::text = $1`, [String(classId).toLowerCase()])).rows[0] || null;

// Whether this user may mark `cls` on `date`: { allowed, code, message }
// (codes: future, outside_year, not_current_year, too_old, role)
const markingRule = (user, cls, date, win = teacherWindow()) => {
  const no = (status, code, message) => ({ allowed: false, status, code, message });
  if (!['admin', 'teacher'].includes(user.role)) return no(403, 'role', 'Only teachers and the administrator mark attendance.');
  if (date > win.today) return no(400, 'future', 'Attendance cannot be marked for a future date.');
  if (date < cls.start_date || date > cls.end_date) {
    return no(400, 'outside_year', `The date is outside the academic year ${cls.year_name} (${cls.start_date} to ${cls.end_date}).`);
  }
  if (user.role === 'teacher') {
    if (!cls.is_current) return no(403, 'not_current_year', 'Teachers mark attendance only for classes of the current academic year.');
    if (date < win.earliest) {
      return no(403, 'too_old', `Teachers can mark or change only today and the previous ${TEACHER_WINDOW_DAYS} days. Ask the administrator to correct older days.`);
    }
  }
  return { allowed: true, code: null, message: null };
};

// Optional note: undefined/null/'' -> null; else a string up to MAX_TEXT
const cleanNote = (note) => {
  if (note === undefined || note === null) return { value: null };
  if (typeof note !== 'string') return { error: 'note must be text.' };
  const v = note.trim();
  if (v.length > MAX_TEXT) return { error: `note can be at most ${MAX_TEXT} characters.` };
  return { value: v || null };
};

class HttpError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}


// ── POST /api/attendance ─────────────────────────────────────
// Mark attendance for an entire class in one request.
// Body: { class_id, date, records: [{ student_id, status, note }] }
const markAttendance = async (req, res) => {
  try {
    const { class_id, date, records } = req.body || {};

    if (!class_id || !date || !Array.isArray(records)) {
      return sendError(res, 'class_id, date, and records[] are required.', 400);
    }
    if (records.length === 0) return sendError(res, 'records array cannot be empty.', 400);
    if (records.length > MAX_RECORDS) return sendError(res, `At most ${MAX_RECORDS} records at once.`, 400);
    if (!isIsoDate(date)) return sendError(res, 'date must be a real date in YYYY-MM-DD format.', 400, { field: 'date' });

    const clean = [];
    const seen = new Set();
    for (const [i, r] of records.entries()) {
      if (!r || typeof r !== 'object' || !r.student_id || !r.status) {
        return sendError(res, 'Each record needs student_id and status.', 400, { field: `records[${i}]` });
      }
      if (!STATUSES.includes(r.status)) {
        return sendError(res, `Invalid status "${r.status}". Use: ${STATUSES.join(', ')}`, 400, { field: `records[${i}].status` });
      }
      const note = cleanNote(r.note);
      if (note.error) return sendError(res, note.error, 400, { field: `records[${i}].note` });
      const sid = String(r.student_id).toLowerCase();
      if (seen.has(sid)) return sendError(res, 'The same student appears twice.', 400, { field: `records[${i}].student_id` });
      seen.add(sid);
      clean.push({ student_id: sid, status: r.status, note: note.value });
    }

    const cls = await loadClass(class_id);
    if (!cls) return sendError(res, 'class_id does not exist.', 400, { field: 'class_id' });
    const win = teacherWindow();
    const rule = markingRule(req.user, cls, date, win);
    if (!rule.allowed) return sendError(res, rule.message, rule.status, { code: rule.code });

    // Every student belongs to this class: now, or by an earlier record in it (moved since)
    const ids = clean.map(r => r.student_id);
    const { rows: inClass } = await db.query(
      `SELECT id::text AS id FROM students WHERE id::text = ANY($2) AND class_id = $1
       UNION SELECT student_id::text FROM attendance WHERE student_id::text = ANY($2) AND class_id = $1`,
      [class_id, ids]);
    const allowed = new Set(inClass.map(r => r.id));
    const outside = ids.filter(id => !allowed.has(id));
    if (outside.length) return sendError(res, 'Some students are not in this class.', 403, { student_ids: outside });

    let teacher_id = null;
    if (req.user.role === 'teacher') {
      teacher_id = (await db.query('SELECT id FROM teachers WHERE user_id = $1', [req.user.id])).rows[0]?.id || null;
    }

    const saved = await inTransaction(async (client) => {
      await assertDateUnlocked(client, class_id, date);   // D29: days absent are on the report card
      const out = [];
      for (const r of clean) {
        const { rows } = await client.query(
          `INSERT INTO attendance (student_id, class_id, marked_by, date, status, note)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (student_id, date)
           DO UPDATE SET
             class_id   = EXCLUDED.class_id,
             status     = EXCLUDED.status,
             note       = EXCLUDED.note,
             marked_by  = EXCLUDED.marked_by,
             updated_at = NOW()
           RETURNING *`,
          [r.student_id, class_id, teacher_id, date, r.status, r.note]);
        out.push(rows[0]);
      }
      // The administrator marking a day the teachers can no longer change: audited
      if (req.user.role === 'admin' && date < win.earliest) {
        await audit(client, req, 'attendance.marked_past', 'class', class_id, {
          date, records: out.map(r => ({ student_id: r.student_id, status: r.status, note: r.note })),
        });
      }
      return out;
    });

    const summary = Object.fromEntries(STATUSES.map(s => [s, saved.filter(r => r.status === s).length]));
    return sendSuccess(res, {
      date,
      class_id,
      total_marked: saved.length,
      summary,
      records: saved,
    }, `Attendance marked for ${saved.length} student(s) on ${date}.`, 201);

  } catch (err) {
    if (err instanceof LockedError) return sendError(res, err.message, err.status, err.errors);
    return sendServerError(res, err, 'Server error while marking attendance.');
  }
};


// ── GET /api/attendance/:classId/:date ────────────────────────
// The class sheet for a date: the active students of the class, plus anyone with a
// record in this class that day (moved since), each with their status (or null).
// `marking` says whether the requester may mark this class on this date, and why not.
const getClassAttendance = async (req, res) => {
  try {
    const { classId, date } = req.params;
    if (!isIsoDate(date)) return sendError(res, 'date must be a real date in YYYY-MM-DD format.', 400, { field: 'date' });

    const cls = await loadClass(classId);
    if (!cls) return sendError(res, 'Class not found.', 404);

    const { rows } = await db.query(
      `SELECT
         s.id            AS student_id,
         s.student_number,
         s.first_name,
         s.last_name,
         s.fathers_name,
         s.first_name_am,
         s.fathers_name_am,
         s.last_name_am,
         s.photo_url,
         s.status        AS student_status,
         a.id            AS attendance_id,
         a.status,
         a.note,
         a.sms_sent,
         a.updated_at    AS marked_at
       FROM students s
       LEFT JOIN attendance a
         ON a.student_id = s.id
         AND a.date = $2
       WHERE (s.class_id = $1 AND s.status = 'active')
          OR (a.class_id = $1)
       ORDER BY s.first_name, s.last_name`,
      [classId, date]
    );

    const summary = {
      total:   rows.length,
      marked:  rows.filter(r => r.status !== null).length,
      ...Object.fromEntries(STATUSES.map(s => [s, rows.filter(r => r.status === s).length])),
    };
    const win = teacherWindow();
    const rule = markingRule(req.user, cls, date, win);

    return sendSuccess(res, {
      class_id: classId,
      date,
      class: {
        id: cls.id, name: cls.name, grade_level: cls.grade_level, section: cls.section,
        academic_year_id: cls.academic_year_id, year_name: cls.year_name,
        start_date: cls.start_date, end_date: cls.end_date, is_current: cls.is_current,
      },
      marking: { allowed: rule.allowed, code: rule.code, message: rule.message, today: win.today, earliest: win.earliest },
      summary,
      students: rows,
    }, `Attendance data for ${date}.`);

  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching attendance.');
  }
};


// ── PUT /api/attendance/:id ───────────────────────────────────
// Correct a single attendance entry (admin only), with a reason; audited.
// Body: { status?, note? (null or '' clears it), reason }
const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { status, reason } = body;

    if (status !== undefined && !STATUSES.includes(status)) {
      return sendError(res, `Invalid status. Use: ${STATUSES.join(', ')}`, 400, { field: 'status' });
    }
    const hasNote = Object.prototype.hasOwnProperty.call(body, 'note');
    const note = cleanNote(body.note);
    if (note.error) return sendError(res, note.error, 400, { field: 'note' });
    if (status === undefined && !hasNote) return sendError(res, 'Send a new status or note.', 400);
    if (typeof reason !== 'string' || !reason.trim()) {
      return sendError(res, 'A reason for the correction is required.', 400, { field: 'reason' });
    }
    if (reason.trim().length > MAX_TEXT) return sendError(res, `reason can be at most ${MAX_TEXT} characters.`, 400, { field: 'reason' });

    const updated = await inTransaction(async (client) => {
      const { rows: old } = await client.query('SELECT * FROM attendance WHERE id = $1 FOR UPDATE', [id]);
      if (!old[0]) throw new HttpError(404, 'Attendance record not found.');
      await assertDateUnlocked(client, old[0].class_id, old[0].date);   // D29
      const next = { status: status ?? old[0].status, note: hasNote ? note.value : old[0].note };
      const { rows } = await client.query(
        `UPDATE attendance SET status = $1, note = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
        [next.status, next.note, id]);
      await audit(client, req, 'attendance.corrected', 'attendance', id, {
        student_id: old[0].student_id, class_id: old[0].class_id, date: old[0].date,
        old: { status: old[0].status, note: old[0].note }, new: next, reason: reason.trim(),
      });
      return rows[0];
    });

    return sendSuccess(res, updated, 'Attendance updated successfully.');

  } catch (err) {
    if (err instanceof HttpError || err instanceof LockedError) return sendError(res, err.message, err.status, err.errors);
    return sendServerError(res, err, 'Server error while updating attendance.');
  }
};


// ── GET /api/attendance/student/:studentId ────────────────────
// A student's attendance history with a summary.
// Query: month (1-12) with year, or year alone; limit (pagination)
const getStudentAttendance = async (req, res) => {
  try {
    const { studentId }   = req.params;
    const { month, year } = req.query;
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);

    if (year !== undefined && !/^\d{4}$/.test(String(year))) return sendError(res, 'year must be a 4-digit year.', 400, { field: 'year' });
    if (month !== undefined) {
      if (!/^(0?[1-9]|1[0-2])$/.test(String(month))) return sendError(res, 'month must be 1 to 12.', 400, { field: 'month' });
      if (year === undefined) return sendError(res, 'month needs a year.', 400, { field: 'year' });
    }

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
         ${RATE}                                          AS attendance_rate
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
// Attendance report for a class over a date range: a students × days grid with totals.
// Query: from, to ('YYYY-MM-DD', at most MAX_REPORT_DAYS days; the app sends the Gregorian
// range of an Ethiopian month), or the older month (1-12) + year (a Gregorian month;
// default: this month).
//   days:     Monday–Friday of the range, plus a Saturday or Sunday that has records (D31),
//             each with the number of records
//   students: the active students of the class plus anyone with a record in it in the range,
//             each with records { date: { id, status, note } } and totals (rate: D32)
const MAX_REPORT_DAYS = 62;

const getClassReport = async (req, res) => {
  try {
    const { classId } = req.params;
    const { from, to, month, year } = req.query;

    let start, end;
    if (from !== undefined || to !== undefined) {
      if (!isIsoDate(from)) return sendError(res, 'from must be a real date in YYYY-MM-DD format.', 400, { field: 'from' });
      if (!isIsoDate(to))   return sendError(res, 'to must be a real date in YYYY-MM-DD format.', 400, { field: 'to' });
      if (to < from) return sendError(res, 'to must not be before from.', 400, { field: 'to' });
      if (addDays(from, MAX_REPORT_DAYS - 1) < to) {
        return sendError(res, `The report covers at most ${MAX_REPORT_DAYS} days.`, 400, { field: 'to' });
      }
      [start, end] = [from, to];
    } else {
      if (month !== undefined && !/^(0?[1-9]|1[0-2])$/.test(String(month))) return sendError(res, 'month must be 1 to 12.', 400, { field: 'month' });
      if (year !== undefined && !/^\d{4}$/.test(String(year))) return sendError(res, 'year must be a 4-digit year.', 400, { field: 'year' });
      const today = localDate();
      const y = Number(year ?? today.slice(0, 4));
      const m = Number(month ?? today.slice(5, 7));
      start = `${y}-${String(m).padStart(2, '0')}-01`;
      end = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
    }

    const cls = await loadClass(classId);
    if (!cls) return sendError(res, 'Class not found.', 404);

    // Students: active in the class now, or with a record in this class in the range
    const { rows: students } = await db.query(
      `SELECT s.id AS student_id, s.student_number, s.first_name, s.last_name, s.fathers_name,
              s.first_name_am, s.fathers_name_am, s.last_name_am, s.status AS student_status,
              COUNT(a.id)                                      AS total_days,
              COUNT(a.id) FILTER (WHERE a.status = 'present')  AS present,
              COUNT(a.id) FILTER (WHERE a.status = 'absent')   AS absent,
              COUNT(a.id) FILTER (WHERE a.status = 'late')     AS late,
              COUNT(a.id) FILTER (WHERE a.status = 'excused')  AS excused,
              ${RATE_A}                                        AS attendance_rate
       FROM students s
       LEFT JOIN attendance a
         ON a.student_id = s.id AND a.class_id = $1 AND a.date BETWEEN $2 AND $3
       WHERE (s.class_id = $1 AND s.status = 'active')
          OR EXISTS (SELECT 1 FROM attendance x WHERE x.student_id = s.id AND x.class_id = $1 AND x.date BETWEEN $2 AND $3)
       GROUP BY s.id
       ORDER BY s.first_name, s.last_name, s.student_number`,
      [classId, start, end]);

    const { rows: records } = await db.query(
      `SELECT id, student_id, date, status, note FROM attendance
       WHERE class_id = $1 AND date BETWEEN $2 AND $3`, [classId, start, end]);

    const byStudent = new Map(students.map(s => [s.student_id, {}]));
    const perDay = new Map();
    for (const r of records) {
      const grid = byStudent.get(r.student_id);
      if (grid) grid[r.date] = { id: r.id, status: r.status, note: r.note };
      perDay.set(r.date, (perDay.get(r.date) || 0) + 1);
    }

    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();   // 0 Sunday … 6 Saturday
      const marked = perDay.get(d) || 0;
      if ((weekday >= 1 && weekday <= 5) || marked) days.push({ date: d, weekday, marked });
    }

    const num = (v) => Number(v);
    const rows = students.map(s => ({
      ...s,
      total_days: num(s.total_days), present: num(s.present), absent: num(s.absent),
      late: num(s.late), excused: num(s.excused),
      attendance_rate: s.attendance_rate === null ? null : Number(s.attendance_rate),
      records: byStudent.get(s.student_id),
    }));
    const rated = rows.filter(r => r.attendance_rate !== null);
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    const classStats = {
      total_students:      rows.length,
      days_marked:         days.filter(d => d.marked).length,
      present: sum('present'), absent: sum('absent'), late: sum('late'), excused: sum('excused'),
      avg_attendance_rate: rated.length ? Number((rated.reduce((t, r) => t + r.attendance_rate, 0) / rated.length).toFixed(1)) : null,
      perfect_attendance:  rated.filter(r => r.attendance_rate === 100).length,
      below_75_percent:    rated.filter(r => r.attendance_rate < 75).length,
    };

    return sendSuccess(res, {
      class_id: classId,
      class: { id: cls.id, name: cls.name, grade_level: cls.grade_level, section: cls.section, academic_year_id: cls.academic_year_id, year_name: cls.year_name },
      from: start,
      to: end,
      ...(from === undefined ? { month: Number(start.slice(5, 7)), year: Number(start.slice(0, 4)) } : {}),
      days,
      class_stats: classStats,
      students: rows,
    }, `Attendance report ${start} to ${end}.`);

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
