// src/controllers/dashboard.controller.js
// ============================================================
// Role dashboards (docs/PERMISSIONS.md, "Dashboard" row).
//   GET /api/dashboard/teacher → own classes only, no finance
//   GET /api/dashboard/school  → admin and principal: the whole school, current year only (M7)
// /api/analytics/* stays for the old frontend's analytics page;
// parents use /api/parent/*, students /api/students/:id/summary.
// ============================================================

const db                  = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { rateSql }         = require('../utils/attendance');
const { SEMESTERS, SCORE_BANDS, bandOf, classResults } = require('../services/results.service');

const RATE_A = rateSql('a');
const UPCOMING_DAYS = 14;

// ── GET /api/dashboard/teacher ───────────────────────────────
const getTeacherDashboard = async (req, res) => {
  try {
    const { rows: t } = await db.query(
      'SELECT id, teacher_number, first_name, last_name, first_name_am, last_name_am FROM teachers WHERE user_id = $1',
      [req.user.id]);
    if (!t[0]) return sendError(res, 'Teacher profile not found.', 404);
    const teacherId = t[0].id;

    // Own classes, the subjects taught there, and active student counts
    const { rows: classes } = await db.query(
      `SELECT c.id AS class_id, c.name AS class_name, c.grade_level, c.section,
              json_agg(json_build_object('subject_id', s.id, 'subject', s.name, 'subject_am', s.name_am) ORDER BY s.name) AS subjects,
              (SELECT COUNT(*)::int FROM students st WHERE st.class_id = c.id AND st.status = 'active') AS student_count
       FROM teacher_classes tc
       JOIN classes  c ON c.id = tc.class_id
       JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.is_current  -- this year's classes (M7a)
       JOIN subjects s ON s.id = tc.subject_id
       WHERE tc.teacher_id = $1
       GROUP BY c.id
       ORDER BY c.grade_level, c.section`,
      [teacherId]);
    const classIds = classes.map(c => c.class_id);

    // Today's attendance per own class: marked vs total
    const { rows: attendance } = await db.query(
      `SELECT c.id AS class_id, c.name AS class_name,
              COUNT(st.id)::int AS total,
              COUNT(a.id)::int  AS marked,
              COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS absent
       FROM classes c
       JOIN students st ON st.class_id = c.id AND st.status = 'active'
       LEFT JOIN attendance a ON a.student_id = st.id AND a.date = CURRENT_DATE
       WHERE c.id = ANY($1::uuid[])
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [classIds]);

    // Upcoming exams (next 14 days) in own classes (this year's, from the list above)
    const { rows: upcoming } = await db.query(
      `SELECT e.id, e.name, e.exam_type, e.term, e.semester, e.exam_date,
              c.name AS class_name, s.name AS subject_name, s.name_am AS subject_name_am,
              (e.exam_date - CURRENT_DATE) AS days_until
       FROM exams e
       JOIN classes  c ON c.id = e.class_id
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.class_id = ANY($1::uuid[])
         AND e.exam_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
       ORDER BY e.exam_date
       LIMIT 20`,
      [classIds]);

    // Grading to do: own class+subject exams of this year's classes (already held or undated)
    // with grades missing
    const { rows: grading } = await db.query(
      `SELECT e.id, e.name, e.term, e.semester, e.exam_date, c.name AS class_name, s.name AS subject_name, s.name_am AS subject_name_am,
              (SELECT COUNT(*)::int FROM grades g WHERE g.exam_id = e.id) AS graded,
              (SELECT COUNT(*)::int FROM students st WHERE st.class_id = e.class_id AND st.status = 'active') AS students
       FROM exams e
       JOIN teacher_classes tc ON tc.class_id = e.class_id AND tc.subject_id = e.subject_id AND tc.teacher_id = $1
       JOIN classes  c ON c.id = e.class_id
       JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.is_current
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.exam_date IS NULL OR e.exam_date <= CURRENT_DATE
       ORDER BY e.exam_date DESC NULLS LAST`,
      [teacherId]);
    const gradingPending = grading.filter(g => g.graded < g.students);

    // Today's timetable slots for this teacher in this year's classes
    const { rows: today } = await db.query(
      `SELECT t.period, t.start_time, t.end_time, t.room,
              c.name AS class_name, s.name AS subject_name, s.name_am AS subject_name_am
       FROM timetable t
       JOIN classes  c ON c.id = t.class_id
       JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.is_current
       JOIN subjects s ON s.id = t.subject_id
       WHERE t.teacher_id = $1
         AND t.day::text = trim(to_char(CURRENT_DATE, 'Day'))
       ORDER BY t.period`,
      [teacherId]);

    return sendSuccess(res, {
      teacher: t[0],
      classes,
      attendance_today: attendance,
      upcoming_exams: upcoming,
      grading_pending: gradingPending,
      timetable_today: today,
    }, 'Teacher dashboard retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error while loading the dashboard.');
  }
};

// ── GET /api/dashboard/school ────────────────────────────────
// The current academic year only: counts, today's attendance per class (marked or not),
// exams of the next 14 days, score bands (D18) per semester and this year's fees.
const getSchoolDashboard = async (req, res) => {
  try {
    const { rows: yr } = await db.query(
      `SELECT id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
              to_char(semester2_start, 'YYYY-MM-DD') AS semester2_start,
              to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today,
              CURRENT_DATE BETWEEN start_date AND end_date AS today_in_year,
              EXTRACT(ISODOW FROM CURRENT_DATE)::int AS weekday
       FROM academic_years WHERE is_current`);
    if (!yr[0]) return sendSuccess(res, { academic_year: null }, 'No current academic year.');
    const { today, today_in_year: todayInYear, weekday, ...year } = yr[0];

    const { rows: counts } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM classes WHERE academic_year_id = $1) AS classes,
              (SELECT COUNT(*)::int FROM students s JOIN classes c ON c.id = s.class_id
                WHERE c.academic_year_id = $1 AND s.status = 'active') AS students,
              (SELECT COUNT(*)::int FROM teachers WHERE is_active) AS teachers`, [year.id]);

    // Today's attendance per class of this year (students = active students now in the class)
    const { rows: classes } = await db.query(
      `SELECT c.id AS class_id, c.name AS class_name, c.grade_level, c.section,
              COUNT(DISTINCT st.id)::int AS students,
              COUNT(a.id)::int AS marked,
              COUNT(a.id) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(a.id) FILTER (WHERE a.status = 'absent')::int  AS absent,
              COUNT(a.id) FILTER (WHERE a.status = 'late')::int    AS late,
              COUNT(a.id) FILTER (WHERE a.status = 'excused')::int AS excused,
              ${RATE_A} AS rate
       FROM classes c
       LEFT JOIN students st ON st.class_id = c.id AND st.status = 'active'
       LEFT JOIN attendance a ON a.student_id = st.id AND a.date = CURRENT_DATE
       WHERE c.academic_year_id = $1
       GROUP BY c.id
       ORDER BY c.grade_level, c.section`, [year.id]);
    const all = await db.query(
      `SELECT ${RATE_A} AS rate FROM attendance a JOIN students st ON st.id = a.student_id
       JOIN classes c ON c.id = st.class_id AND c.academic_year_id = $1 WHERE a.date = CURRENT_DATE`, [year.id]);
    for (const c of classes) {
      c.rate = c.rate === null ? null : Number(c.rate);
      c.status = c.students === 0 ? 'no_students' : c.marked === 0 ? 'not_marked' : c.marked < c.students ? 'partly_marked' : 'marked';
    }
    const attendanceToday = {
      date: today,
      // Monday-Friday (D31); a Saturday only when it has records
      school_day: todayInYear && (weekday <= 5 || (weekday === 6 && classes.some((c) => c.marked > 0))),
      rate: all.rows[0].rate === null ? null : Number(all.rows[0].rate),
      classes_marked: classes.filter((c) => c.status === 'marked').length,
      classes_partly_marked: classes.filter((c) => c.status === 'partly_marked').length,
      classes_not_marked: classes.filter((c) => c.status === 'not_marked').length,
      classes,
    };

    // Exams of the next 14 days in this year's classes
    const { rows: upcoming } = await db.query(
      `SELECT e.id, e.name, e.exam_type, e.semester, to_char(e.exam_date, 'YYYY-MM-DD') AS exam_date,
              to_char(es.start_time, 'HH24:MI') AS start_time, to_char(es.end_time, 'HH24:MI') AS end_time, es.room, e.max_score,
              c.id AS class_id, c.name AS class_name, s.name AS subject_name, s.name_am AS subject_name_am,
              (e.exam_date - CURRENT_DATE) AS days_until
       FROM exams e
       JOIN classes  c ON c.id = e.class_id AND c.academic_year_id = $1
       JOIN subjects s ON s.id = e.subject_id
       LEFT JOIN exam_schedules es ON es.exam_id = e.id
       WHERE e.exam_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ${UPCOMING_DAYS}
       ORDER BY e.exam_date, es.start_time NULLS LAST, c.grade_level, c.section
       LIMIT 50`, [year.id]);

    // Score bands (D18) of complete subject scores per semester, from the results
    const results = {};
    for (const sem of SEMESTERS) {
      const bands = Object.fromEntries(SCORE_BANDS.map((b) => [b.key, 0]));
      let complete = 0, incomplete = 0;
      for (const c of classes) {
        const r = await classResults(c.class_id, sem);
        for (const st of r.students) {
          for (const v of Object.values(st.subjects)) {
            if (v.complete) { bands[bandOf(v.score)]++; complete++; } else if (v.score !== null && v.score !== undefined) incomplete++;
          }
        }
      }
      results[sem] = { complete, incomplete, bands: SCORE_BANDS.map((b) => ({ band: b.key, count: bands[b.key] })) };
    }

    // This year's fees (current payments; the monthly view comes with M8)
    const { rows: fees } = await db.query(
      `WITH per_student AS (
         SELECT student_id, SUM(amount_due) AS due, SUM(amount_paid) AS paid
         FROM payments WHERE academic_year_id = $1 GROUP BY student_id
       )
       SELECT COALESCE(SUM(due), 0)  AS expected,
              COALESCE(SUM(paid), 0) AS collected,
              COALESCE(SUM(GREATEST(due - paid, 0)), 0) AS outstanding,
              COALESCE(SUM(GREATEST(paid - due, 0)), 0) AS credit,
              COUNT(*) FILTER (WHERE due > paid)::int  AS students_owing,
              ROUND(COALESCE(SUM(paid), 0) * 100 / NULLIF(COALESCE(SUM(due), 0), 0), 1) AS collection_rate
       FROM per_student`, [year.id]);
    const f = fees[0];

    return sendSuccess(res, {
      academic_year: year,
      counts: counts[0],
      attendance_today: attendanceToday,
      upcoming_exams: { days: UPCOMING_DAYS, exams: upcoming },
      results,
      fees: {
        expected: Number(f.expected), collected: Number(f.collected), outstanding: Number(f.outstanding),
        credit: Number(f.credit), students_owing: f.students_owing,
        collection_rate: f.collection_rate === null ? null : Number(f.collection_rate),
      },
    }, 'School dashboard retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error while loading the dashboard.');
  }
};

module.exports = { getTeacherDashboard, getSchoolDashboard };
