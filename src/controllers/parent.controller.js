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
const { sendServerError } = require('../utils/errors');
const { rateSql } = require('../utils/attendance');
const { studentTotals, ecYearOf } = require('../services/fees.service');
const { toCents, fromCents } = require('../utils/money');
const RATE   = rateSql();   // attendance rate (M4): late attended, excused left out


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

const { studentResults, ResultsError } = require('../services/results.service');

// The child's results (B2), or null when there are none yet (no class, no scores)
const resultsOrNull = async (studentId) => {
  try { return await studentResults(studentId); } catch (err) {
    if (err instanceof ResultsError && err.status === 404) return null;
    throw err;
  }
};


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
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/parent/children ─────────────────────────────────
// Every linked child, archived and graduated ones too (status), with the Amharic names, the
// class and whether its year is the current one (M6).
const getChildren = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.student_number, s.first_name, s.last_name,
              s.fathers_name, s.first_name_am, s.fathers_name_am, s.last_name_am,
              s.gender, s.date_of_birth, s.photo_url,
              s.status, s.enrollment_date,
              c.id AS class_id, c.name AS class_name, c.grade_level, c.section,
              ay.id AS academic_year_id, ay.name AS academic_year, ay.end_date AS academic_year_end,
              COALESCE(ay.is_current, false) AS year_is_current, sp.relationship
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
    return sendServerError(res, err, 'Server error.');
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
              ${RATE} AS rate
       FROM attendance WHERE student_id=$1
       AND date >= date_trunc('month', CURRENT_DATE)`, [studentId]
    );

    // Recent 5 grades
    const { rows: grades } = await db.query(
      `SELECT g.score, e.max_score,
              s.name AS subject, e.semester, e.exam_type, e.exam_date
       FROM grades g
       JOIN exams e ON e.id=g.exam_id
       JOIN subjects s ON s.id=e.subject_id
       WHERE g.student_id=$1
       ORDER BY g.entered_at DESC LIMIT 5`, [studentId]
    );

    // Fee balance (M8): balance = owed now, upcoming = months not yet due
    const fees = [await studentTotals(db, studentId)];

    // Semester and yearly averages and ranks (B2) instead of a GPA
    const r = await resultsOrNull(studentId);
    const pick = (x) => (x ? { average: x.average, rank: x.rank, ranked_count: x.ranked_count, class_size: x.class_size } : null);
    const results = r && {
      academic_year: r.academic_year, class: r.class,
      semester1: pick(r.semesters.semester1), semester2: pick(r.semesters.semester2),
      year: { ...pick(r.year), promotion: r.year.promotion },
    };

    return sendSuccess(res, {
      student:       stu[0],
      attendance:    att[0],
      recent_grades: grades,
      fees:          fees[0],
      results,
    }, 'Summary retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/parent/child/:studentId/grades ──────────────────
const getChildGrades = async (req, res) => {
  try {
    const { studentId } = req.params;
    const owns = await verifyParentChild(req.user.id, studentId);
    if (!owns) return sendError(res, 'Access denied.', 403);

    const { rows } = await db.query(
      `SELECT g.score, g.remarks,
              e.name AS exam_name, e.exam_type, e.semester, e.max_score, e.exam_date,
              s.name AS subject_name,
              ROUND((g.score/e.max_score)*100,1) AS percentage
       FROM grades g
       JOIN exams e ON e.id=g.exam_id
       JOIN subjects s ON s.id=e.subject_id
       WHERE g.student_id=$1
       ORDER BY e.semester, s.name, e.exam_date DESC`, [studentId]
    );

    const bySubject = {};
    rows.forEach(r => {
      if (!bySubject[r.subject_name]) {
        bySubject[r.subject_name] = { subject: r.subject_name, exams: [] };
      }
      bySubject[r.subject_name].exams.push(r);
    });

    // No GPA since B2: the results (semester and yearly scores, averages, ranks) instead
    return sendSuccess(res, {
      total_exams: rows.length,
      by_subject: Object.values(bySubject),
      results: await resultsOrNull(studentId),
    }, 'Grades retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
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
              ${RATE} AS rate
       FROM attendance WHERE student_id=$1`, [studentId]
    );

    const { rows: monthly } = await db.query(
      `SELECT TO_CHAR(date,'YYYY-MM') AS month,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status='present') AS present,
              COUNT(*) FILTER (WHERE status='absent')  AS absent,
              ${RATE} AS rate
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
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/parent/child/:studentId/fees ────────────────────
const getChildFees = async (req, res) => {
  try {
    const { studentId } = req.params;
    const owns = await verifyParentChild(req.user.id, studentId);
    if (!owns) return sendError(res, 'Access denied.', 403);

    // The monthly view (D21, M8): this year's months with what is due, paid and open per
    // fee, one-time and older (legacy term) charges, and the receipts.
    const { rows: [yr] } = await db.query(
      `SELECT ay.id, ay.name, ay.end_date FROM students s
       JOIN academic_years ay ON ay.id = COALESCE((SELECT c.academic_year_id FROM classes c WHERE c.id = s.class_id),
                                                 (SELECT id FROM academic_years WHERE is_current LIMIT 1))
       WHERE s.id = $1`, [studentId]);
    const { rows: charges } = yr ? await db.query(
      `SELECT b.id, b.category, b.eth_month, b.net_due, b.paid, b.balance, b.status, b.due_date, b.description, b.legacy_term,
              b.academic_year_id, (b.due_date < CURRENT_DATE AND b.balance > 0) AS overdue
       FROM student_charge_balances b
       WHERE b.student_id = $1 AND (b.academic_year_id = $2 OR (b.balance <> 0 AND b.status <> 'waived'))
       ORDER BY b.eth_month NULLS LAST, b.category`, [studentId, yr.id]) : { rows: [] };
    const months = [];
    for (const c of charges.filter((x) => x.eth_month !== null && x.academic_year_id === yr.id)) {
      let m = months.find((x) => x.eth_month === c.eth_month);
      if (!m) months.push(m = { eth_month: c.eth_month, due_date: c.due_date, due: 0, paid: 0, balance: 0, overdue: false, charges: [] });
      m.due += toCents(c.net_due); m.paid += toCents(c.paid); m.balance += toCents(c.balance);
      m.overdue = m.overdue || c.overdue;
      m.charges.push(c);
    }
    for (const m of months) {
      m.status = m.charges.every((c) => c.status === 'waived') ? 'waived' : m.balance <= 0 ? 'paid' : m.paid > 0 ? 'partial' : 'unpaid';
      for (const k of ['due', 'paid', 'balance']) m[k] = fromCents(m[k]);
    }
    const { rows } = await db.query(
      `SELECT p.id, p.receipt_number, p.payment_method, p.payment_date, p.amount, p.reference,
              CASE WHEN p.reversed_at IS NULL THEN 'valid' ELSE 'reversed' END AS status,
              (SELECT json_agg(json_build_object('amount', a.amount, 'category', c.category, 'eth_month', c.eth_month,
                       'legacy_term', c.legacy_term) ORDER BY c.eth_month NULLS LAST, c.category)
               FROM payment_allocations a JOIN student_charges c ON c.id = a.charge_id WHERE a.payment_id = p.id) AS lines
       FROM payments p WHERE p.student_id = $1
       ORDER BY p.payment_date DESC, p.created_at DESC`, [studentId]);

    return sendSuccess(res, {
      overview: await studentTotals(db, studentId),
      year: yr ? { id: yr.id, name: yr.name, end_date: yr.end_date, eth_year: ecYearOf(yr) } : null,
      months,
      one_time: charges.filter((c) => c.eth_month === null && !c.legacy_term && c.academic_year_id === yr?.id),
      // Older charges: legacy term payments, and anything still open from another year
      earlier: charges.filter((c) => c.legacy_term || c.academic_year_id !== yr?.id),
      payments: rows,
    }, 'Fees retrieved.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── GET /api/parent/fees ─────────────────────────────────────
// Fee balance for every linked child, plus family totals.
const getFamilyFees = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id AS student_id, s.student_number,
              s.first_name || ' ' || s.last_name AS name,
              s.first_name_am, s.fathers_name_am, s.last_name_am,
              c.name AS class_name
       FROM parents p
       JOIN student_parents sp ON sp.parent_id = p.id
       JOIN students s         ON s.id = sp.student_id
       LEFT JOIN classes c     ON c.id = s.class_id
       WHERE p.user_id = $1
       ORDER BY s.first_name`,
      [req.user.id]
    );

    // M8: per child all charges; balance = owed now, upcoming = months not yet due (paid ahead or not)
    const children = [];
    for (const r of rows) children.push({ ...r, ...(await studentTotals(db, r.student_id)) });
    const sum = (k) => fromCents(children.reduce((a, c) => a + toCents(c[k]), 0));

    return sendSuccess(res, {
      children,
      family: { total_due: sum('total_due'), total_paid: sum('total_paid'), balance: sum('balance'), upcoming: sum('upcoming'), overdue: sum('overdue') },
    }, `Fees for ${children.length} child(ren).`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
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
              s.name AS subject, s.name_am AS subject_name_am, te.first_name||' '||te.last_name AS teacher
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
    return sendServerError(res, err, 'Server error.');
  }
};


module.exports = {
  getParentProfile, getChildren, getChildSummary,
  getChildGrades, getChildAttendance, getChildFees, getChildTimetable, getFamilyFees,
};
