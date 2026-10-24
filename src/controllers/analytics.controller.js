// src/controllers/analytics.controller.js
const db            = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { rateSql } = require('../utils/attendance');
const { SEMESTERS, SCORE_BANDS, bandOf, classResults } = require('../services/results.service');
const { totalsSql } = require('../services/fees.service');
const RATE   = rateSql();   // attendance rate (M4): late attended, excused left out
const RATE_A = rateSql('a');   // attendance rate (M4): late attended, excused left out

// GET /api/analytics/overview
const getOverview = async (req, res) => {
  try {
    const { rows: stu } = await db.query(
      `SELECT COUNT(*) AS total,
         COUNT(*) FILTER(WHERE status='active')    AS active,
         COUNT(*) FILTER(WHERE status='graduated') AS graduated,
         COUNT(*) FILTER(WHERE gender='male')      AS male,
         COUNT(*) FILTER(WHERE gender='female')    AS female,
         COUNT(*) FILTER(WHERE created_at >= NOW()-INTERVAL '30 days') AS new_this_month
       FROM students`
    );
    const { rows: tch } = await db.query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE is_active=TRUE) AS active FROM teachers`
    );
    const { rows: att } = await db.query(
      `SELECT COUNT(*) AS total_marked,
         COUNT(*) FILTER(WHERE status='present') AS present,
         COUNT(*) FILTER(WHERE status='absent')  AS absent,
         COUNT(*) FILTER(WHERE status='late')    AS late,
         ${RATE} AS rate
       FROM attendance WHERE date=CURRENT_DATE`
    );
    const { rows: attMonth } = await db.query(
      `SELECT ${RATE} AS rate
       FROM attendance WHERE date >= date_trunc('month', CURRENT_DATE)`
    );
    // Same definitions as GET /api/finance/summary (fees.service totalsSql), over all years
    const { rows: fin } = await db.query(totalsSql());
    fin[0].outstanding = fin[0].total_outstanding;
    const { rows: gr } = await db.query(
      `SELECT ROUND(AVG(g.score/e.max_score*100),1) AS avg_score,
              COUNT(DISTINCT g.student_id) AS graded_students,
              COUNT(DISTINCT e.id) AS total_exams
       FROM grades g JOIN exams e ON e.id=g.exam_id`
    );
    const { rows: upcoming } = await db.query(
      `SELECT COUNT(*) AS count FROM exams
       WHERE exam_date >= CURRENT_DATE AND exam_date <= CURRENT_DATE+30`
    );
    const { rows: cls } = await db.query(
      `SELECT COUNT(*) AS total FROM classes c
       JOIN academic_years ay ON ay.id=c.academic_year_id AND ay.is_current=TRUE`
    );
    return sendSuccess(res, {
      students: stu[0], teachers: tch[0],
      attendance_today: att[0], attendance_month: attMonth[0],
      finance: fin[0], grades: gr[0],
      upcoming_exams: upcoming[0].count, classes: cls[0],
    }, 'Overview retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/analytics/students
const getStudentAnalytics = async (req, res) => {
  try {
    const { rows: byGrade } = await db.query(
      `SELECT c.grade_level,
         COUNT(DISTINCT s.id) AS count,
         COUNT(*) FILTER(WHERE s.gender='male')   AS male,
         COUNT(*) FILTER(WHERE s.gender='female') AS female
       FROM students s
       JOIN classes c ON c.id=s.class_id
       JOIN academic_years ay ON ay.id=c.academic_year_id AND ay.is_current=TRUE
       WHERE s.status='active'
       GROUP BY c.grade_level ORDER BY c.grade_level`
    );
    const { rows: trend } = await db.query(
      `SELECT TO_CHAR(enrollment_date,'YYYY-MM') AS month, COUNT(*) AS count
       FROM students WHERE enrollment_date >= NOW()-INTERVAL '6 months'
       GROUP BY TO_CHAR(enrollment_date,'YYYY-MM') ORDER BY month`
    );
    const { rows: byStatus } = await db.query(
      `SELECT status, COUNT(*) AS count FROM students GROUP BY status`
    );
    return sendSuccess(res, { by_grade: byGrade, trend, by_status: byStatus },
      'Student analytics retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/analytics/attendance
const getAttendanceAnalytics = async (req, res) => {
  try {
    const { rows: daily } = await db.query(
      `SELECT date,
         COUNT(*) FILTER(WHERE status='present') AS present,
         COUNT(*) FILTER(WHERE status='absent')  AS absent,
         ${RATE} AS rate
       FROM attendance WHERE date >= CURRENT_DATE-30
       GROUP BY date ORDER BY date`
    );
    const { rows: byGrade } = await db.query(
      `SELECT c.grade_level,
         ${RATE_A} AS rate,
         COUNT(*) FILTER(WHERE a.status='absent') AS absent_count
       FROM attendance a
       JOIN students s ON s.id=a.student_id
       JOIN classes  c ON c.id=s.class_id
       WHERE a.date >= date_trunc('month', CURRENT_DATE)
       GROUP BY c.grade_level ORDER BY c.grade_level`
    );
    const { rows: mostAbsent } = await db.query(
      `SELECT s.first_name||' '||s.last_name AS name,
              s.student_number, c.name AS class_name,
              COUNT(*) FILTER(WHERE a.status='absent') AS absent_days,
              ${RATE_A} AS rate
       FROM attendance a
       JOIN students s ON s.id=a.student_id
       JOIN classes  c ON c.id=s.class_id
       WHERE a.date >= date_trunc('month', CURRENT_DATE)
       GROUP BY s.id, s.first_name, s.last_name, s.student_number, c.name
       HAVING COUNT(*) FILTER(WHERE a.status='absent') > 0
       ORDER BY absent_days DESC LIMIT 10`
    );
    return sendSuccess(res, { daily_trend: daily, by_grade: byGrade, most_absent: mostAbsent },
      'Attendance analytics retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/analytics/grades
const getGradeAnalytics = async (req, res) => {
  try {
    const { rows: bySubject } = await db.query(
      `SELECT s.name AS subject, s.code,
         ROUND(AVG(g.score/e.max_score*100),1) AS avg_score,
         COUNT(DISTINCT g.student_id) AS student_count,
         COUNT(*) FILTER(WHERE g.score/e.max_score*100>=50) AS passing,
         COUNT(*) FILTER(WHERE g.score/e.max_score*100<50)  AS failing
       FROM grades g JOIN exams e ON e.id=g.exam_id JOIN subjects s ON s.id=e.subject_id
       GROUP BY s.id, s.name, s.code ORDER BY avg_score DESC`
    );
    // Score bands (D18) of complete subject scores per semester, current year, from the results
    const scoreBands = {};
    const { rows: classes } = await db.query(
      'SELECT c.id FROM classes c JOIN academic_years y ON y.id = c.academic_year_id WHERE y.is_current');
    for (const sem of SEMESTERS) {
      const counts = Object.fromEntries(SCORE_BANDS.map((b) => [b.key, 0]));
      for (const c of classes) {
        const r = await classResults(c.id, sem);
        for (const st of r.students) {
          for (const v of Object.values(st.subjects)) if (v.complete) counts[bandOf(v.score)]++;
        }
      }
      scoreBands[sem] = SCORE_BANDS.map((b) => ({ band: b.key, count: counts[b.key] }));
    }
    const { rows: topStudents } = await db.query(
      `SELECT s.first_name||' '||s.last_name AS name,
              s.student_number, c.name AS class_name,
              ROUND(AVG(g.score/e.max_score*100),1) AS avg_score
       FROM grades g JOIN students s ON s.id=g.student_id
       JOIN exams e ON e.id=g.exam_id JOIN classes c ON c.id=s.class_id
       WHERE s.status='active'
       GROUP BY s.id, s.first_name, s.last_name, s.student_number, c.name
       ORDER BY avg_score DESC LIMIT 10`
    );
    return sendSuccess(res, { by_subject: bySubject, score_bands: scoreBands, top_students: topStudents },
      'Grade analytics retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/analytics/finance
const getFinanceAnalytics = async (req, res) => {
  try {
    // Payments (receipts) not reversed; charges for expected / collected per category
    const { rows: monthly } = await db.query(
      `SELECT TO_CHAR(payment_date,'YYYY-MM') AS month,
         SUM(amount) AS collected, COUNT(*) AS transactions
       FROM payments WHERE payment_date >= NOW()-INTERVAL '6 months' AND reversed_at IS NULL
       GROUP BY TO_CHAR(payment_date,'YYYY-MM') ORDER BY month`
    );
    const { rows: byMethod } = await db.query(
      `SELECT payment_method, COUNT(*) AS transactions, SUM(amount) AS total
       FROM payments WHERE reversed_at IS NULL GROUP BY payment_method ORDER BY total DESC`
    );
    const { rows: byCategory } = await db.query(
      `SELECT category, SUM(net_due) AS expected, SUM(paid) AS collected, SUM(balance) AS outstanding
       FROM student_charge_balances GROUP BY category ORDER BY expected DESC`
    );
    return sendSuccess(res, { monthly_trend: monthly, by_method: byMethod, by_category: byCategory },
      'Finance analytics retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

module.exports = {
  getOverview, getStudentAnalytics,
  getAttendanceAnalytics, getGradeAnalytics, getFinanceAnalytics,
};
