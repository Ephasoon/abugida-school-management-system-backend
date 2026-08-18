// src/controllers/parent.controller.js
// ============================================================
// Parent Portal — parents can ONLY see their OWN child's data.
// Security: every endpoint verifies parent-child relationship.
//
//   GET /api/parent/profile                    → parent profile
//   GET /api/parent/children                   → list children
//   GET /api/parent/child/:id/summary          → dashboard
//   GET /api/parent/child/:id/grades           → grades
//   GET /api/parent/child/:id/attendance       → attendance
//   GET /api/parent/child/:id/fees             → fee balance
//   GET /api/parent/child/:id/timetable        → class schedule
// ============================================================

const db            = require('../config/db');
const { sendSuccess,
        sendError } = require('../utils/response');


// ── Security: verify parent owns this child ───────────────────
const verifyParentChild = async (parentUserId, studentId) => {
  const { rows } = await db.query(
    `SELECT sp.id FROM student_parents sp
     JOIN parents p ON p.id = sp.parent_id
     WHERE p.user_id = $1 AND sp.student_id = $2`,
    [parentUserId, studentId]
  );
  return rows.length > 0;
};

const gradeToPoints = (l) => ({
  'A+':4.0,'A':4.0,'A-':3.7,'B+':3.3,'B':3.0,'B-':2.7,
  'C+':2.3,'C':2.0,'C-':1.7,'D':1.0,'F':0.0,
}[l] || 0);


// ── GET /api/parent/profile ──────────────────────────────────
const getParentProfile = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, u.email FROM parents p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return sendError(res, 'Parent profile not found.', 404);
    return sendSuccess(res, rows[0], 'Profile retrieved.');
  } catch (err) {
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/parent/children ─────────────────────────────────
const getChildren = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.student_number, s.first_name, s.last_name,
              s.fathers_name, s.gender, s.date_of_birth, s.photo_url,
              s.status, s.enrollment_date,
              c.name AS class_name, c.grade_level, c.section,
              ay.name AS academic_year, sp.relationship
       FROM students s
       JOIN student_parents sp ON sp.student_id = s.id
       JOIN parents p ON p.id = sp.parent_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE p.user_id = $1 ORDER BY s.first_name`,
      [req.user.id]
    );
    return sendSuccess(res, rows, `${rows.length} child(ren) found.`);
  } catch (err) {
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/parent/child/:studentId/summary ─────────────────
const getChildSummary = async (req, res) => {
  try {
    const { studentId } = req.params;
    const owns = await verifyParentChild(req.user.id, studentId);
    if (!owns) return sendError(res, 'Access denied.', 403);

    // Student profile
    const { rows: stu } = await db.query(
      `SELECT s.*, c.name AS class_name, c.grade_level, c.section
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1`, [studentId]
    );
    if (!stu[0]) return sendError(res, 'Student not found.', 404);

    // This month attendance
    const { rows: att } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status='present') AS present,
              COUNT(*) FILTER (WHERE status='absent')  AS absent,
              COUNT(*) FILTER (WHERE status='late')    AS late,
              ROUND(COUNT(*) FILTER (WHERE status='present')*100.0/NULLIF(COUNT(*),0),1) AS rate
       FROM attendance WHERE student_id=$1
       AND date >= date_trunc('month', CURRENT_DATE)`, [studentId]
    );

    // Recent 5 grades
    const { rows: grades } = await db.query(
      `SELECT g.score, g.grade_letter, e.max_score,
              s.name AS subject, e.term, e.exam_type, e.exam_date
       FROM grades g
       JOIN exams e ON e.id=g.exam_id
       JOIN subjects s ON s.id=e.subject_id
       WHERE g.student_id=$1
       ORDER BY g.entered_at DESC LIMIT 5`, [studentId]
    );

    // Fee balance
    const { rows: fees } = await db.query(
      `SELECT COALESCE(SUM(amount_due),0) AS total_due,
              COALESCE(SUM(amount_paid),0) AS total_paid,
              COALESCE(SUM(amount_due)-SUM(amount_paid),0) AS balance
       FROM payments WHERE student_id=$1`, [studentId]
    );

    return sendSuccess(res, {
      student:       stu[0],
      attendance:    att[0],
      recent_grades: grades,
      fees:          fees[0],
    }, 'Summary retrieved.');
  } catch (err) {
    console.error('getChildSummary:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/parent/child/:studentId/grades ──────────────────
const getChildGrades = async (req, res) => {
  try {
    const { studentId } = req.params;
    const owns = await verifyParentChild(req.user.id, studentId);
    if (!owns) return sendError(res, 'Access denied.', 403);

    const { rows } = await db.query(
      `SELECT g.score, g.grade_letter, g.remarks,
              e.name AS exam_name, e.exam_type, e.term, e.max_score, e.exam_date,
              s.name AS subject_name,
              ROUND((g.score/e.max_score)*100,1) AS percentage
       FROM grades g
       JOIN exams e ON e.id=g.exam_id
       JOIN subjects s ON s.id=e.subject_id
       WHERE g.student_id=$1
       ORDER BY e.term, s.name, e.exam_date DESC`, [studentId]
    );

    const bySubject = {};
    rows.forEach(r => {
      if (!bySubject[r.subject_name]) {
        bySubject[r.subject_name] = { subject: r.subject_name, exams: [] };
      }
      bySubject[r.subject_name].exams.push(r);
    });

    const gpa = rows.length
      ? (rows.map(r=>gradeToPoints(r.grade_letter))
             .reduce((a,b)=>a+b,0) / rows.length).toFixed(2)
      : '0.00';

    return sendSuccess(res, {
      gpa, total_exams: rows.length,
      by_subject: Object.values(bySubject),
    }, 'Grades retrieved.');
  } catch (err) {
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/parent/child/:studentId/attendance ──────────────
const getChildAttendance = async (req, res) => {
  try {
    const { studentId } = req.params;
    const owns = await verifyParentChild(req.user.id, studentId);
    if (!owns) return sendError(res, 'Access denied.', 403);

    const { rows: overall } = await db.query(
      `SELECT COUNT(*) AS total_days,
              COUNT(*) FILTER (WHERE status='present') AS present,
              COUNT(*) FILTER (WHERE status='absent')  AS absent,
              COUNT(*) FILTER (WHERE status='late')    AS late,
              ROUND(COUNT(*) FILTER(WHERE status='present')*100.0/NULLIF(COUNT(*),0),1) AS rate
       FROM attendance WHERE student_id=$1`, [studentId]
    );

    const { rows: monthly } = await db.query(
      `SELECT TO_CHAR(date,'YYYY-MM') AS month,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status='present') AS present,
              COUNT(*) FILTER (WHERE status='absent')  AS absent,
              ROUND(COUNT(*) FILTER(WHERE status='present')*100.0/NULLIF(COUNT(*),0),1) AS rate
       FROM attendance WHERE student_id=$1
       GROUP BY TO_CHAR(date,'YYYY-MM')
       ORDER BY month DESC LIMIT 6`, [studentId]
    );

    const { rows: recent } = await db.query(
      `SELECT date, status, note FROM attendance
       WHERE student_id=$1
       ORDER BY date DESC LIMIT 30`, [studentId]
    );

    return sendSuccess(res, { overall: overall[0], monthly, recent }, 'Attendance retrieved.');
  } catch (err) {
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/parent/child/:studentId/fees ────────────────────
const getChildFees = async (req, res) => {
  try {
    const { studentId } = req.params;
    const owns = await verifyParentChild(req.user.id, studentId);
    if (!owns) return sendError(res, 'Access denied.', 403);

    const { rows } = await db.query(
      `SELECT term, category, amount_due, amount_paid,
              amount_due-amount_paid AS balance,
              payment_method, payment_date, receipt_number
       FROM payments WHERE student_id=$1
       ORDER BY payment_date DESC`, [studentId]
    );

    const totalDue  = rows.reduce((s,p)=>s+parseFloat(p.amount_due),0);
    const totalPaid = rows.reduce((s,p)=>s+parseFloat(p.amount_paid),0);

    return sendSuccess(res, {
      overview: {
        total_due: totalDue, total_paid: totalPaid,
        balance: totalDue - totalPaid,
        status: totalDue<=totalPaid ? 'paid' : totalPaid===0 ? 'unpaid' : 'partial',
      },
      payments: rows,
    }, 'Fees retrieved.');
  } catch (err) {
    return sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/parent/child/:studentId/timetable ───────────────
const getChildTimetable = async (req, res) => {
  try {
    const { studentId } = req.params;
    const owns = await verifyParentChild(req.user.id, studentId);
    if (!owns) return sendError(res, 'Access denied.', 403);

    const { rows: stu } = await db.query(
      'SELECT class_id FROM students WHERE id=$1', [studentId]
    );
    if (!stu[0]?.class_id) return sendError(res, 'No class assigned.', 404);

    const { rows } = await db.query(
      `SELECT t.day, t.period, t.start_time, t.end_time, t.room,
              s.name AS subject, te.first_name||' '||te.last_name AS teacher
       FROM timetable t
       LEFT JOIN subjects s  ON s.id=t.subject_id
       LEFT JOIN teachers te ON te.id=t.teacher_id
       WHERE t.class_id=$1
       ORDER BY CASE t.day
         WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2
         WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4
         WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 END, t.period`,
      [stu[0].class_id]
    );

    const byDay = {};
    ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      .forEach(d => { byDay[d] = []; });
    rows.forEach(r => { if (byDay[r.day]) byDay[r.day].push(r); });

    return sendSuccess(res, { by_day: byDay }, 'Timetable retrieved.');
  } catch (err) {
    return sendError(res, 'Server error.', 500);
  }
};


module.exports = {
  getParentProfile, getChildren, getChildSummary,
  getChildGrades, getChildAttendance, getChildFees, getChildTimetable,
};
