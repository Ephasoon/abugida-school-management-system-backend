// src/controllers/dashboard.controller.js
// ============================================================
// Role dashboards (docs/PERMISSIONS.md, "Dashboard" row).
//   GET /api/dashboard/teacher → own classes only, no finance
// Admin and principal use /api/analytics/overview (whole school);
// parents use /api/parent/*, students /api/students/:id/summary.
// ============================================================

const db                  = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');

// ── GET /api/dashboard/teacher ───────────────────────────────
const getTeacherDashboard = async (req, res) => {
  try {
    const { rows: t } = await db.query(
      'SELECT id, teacher_number, first_name, last_name FROM teachers WHERE user_id = $1',
      [req.user.id]);
    if (!t[0]) return sendError(res, 'Teacher profile not found.', 404);
    const teacherId = t[0].id;

    // Own classes, the subjects taught there, and active student counts
    const { rows: classes } = await db.query(
      `SELECT c.id AS class_id, c.name AS class_name, c.grade_level, c.section,
              json_agg(json_build_object('subject_id', s.id, 'subject', s.name) ORDER BY s.name) AS subjects,
              (SELECT COUNT(*)::int FROM students st WHERE st.class_id = c.id AND st.status = 'active') AS student_count
       FROM teacher_classes tc
       JOIN classes  c ON c.id = tc.class_id
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

    // Upcoming exams (next 14 days) in own classes
    const { rows: upcoming } = await db.query(
      `SELECT e.id, e.name, e.exam_type, e.term, e.exam_date,
              c.name AS class_name, s.name AS subject_name,
              (e.exam_date - CURRENT_DATE) AS days_until
       FROM exams e
       JOIN classes  c ON c.id = e.class_id
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.class_id = ANY($1::uuid[])
         AND e.exam_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
       ORDER BY e.exam_date
       LIMIT 20`,
      [classIds]);

    // Grading to do: own class+subject exams (already held or undated) with grades missing
    const { rows: grading } = await db.query(
      `SELECT e.id, e.name, e.term, e.exam_date, c.name AS class_name, s.name AS subject_name,
              (SELECT COUNT(*)::int FROM grades g WHERE g.exam_id = e.id) AS graded,
              (SELECT COUNT(*)::int FROM students st WHERE st.class_id = e.class_id AND st.status = 'active') AS students
       FROM exams e
       JOIN teacher_classes tc ON tc.class_id = e.class_id AND tc.subject_id = e.subject_id AND tc.teacher_id = $1
       JOIN classes  c ON c.id = e.class_id
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.exam_date IS NULL OR e.exam_date <= CURRENT_DATE
       ORDER BY e.exam_date DESC NULLS LAST`,
      [teacherId]);
    const gradingPending = grading.filter(g => g.graded < g.students);

    // Today's timetable slots for this teacher
    const { rows: today } = await db.query(
      `SELECT t.period, t.start_time, t.end_time, t.room,
              c.name AS class_name, s.name AS subject_name
       FROM timetable t
       JOIN classes  c ON c.id = t.class_id
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

module.exports = { getTeacherDashboard };
