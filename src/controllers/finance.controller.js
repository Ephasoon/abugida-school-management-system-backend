// src/controllers/finance.controller.js
// Fixed: academic_year_id fetched automatically from current active year

const db            = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');

// Helper: get current academic year
const getCurrentYear = async () => {
  const { rows } = await db.query(
    'SELECT id, name FROM academic_years WHERE is_current = TRUE LIMIT 1'
  );
  return rows[0] || null;
};

// Helper: generate receipt number
const genReceipt = () => {
  const ts  = Date.now().toString().slice(-8);
  const rnd = Math.floor(Math.random() * 1000).toString().padStart(3,'0');
  return `RCP-${ts}-${rnd}`;
};

// POST /api/finance/payments — Record a payment
const recordPayment = async (req, res) => {
  try {
    const {
      student_id, amount_due, amount_paid,
      payment_method, payment_date, category,
      term, fee_structure_id, reference, notes,
    } = req.body;

    // 0 is a valid amount (e.g. a fee charged but not yet paid), so check for absence, not falsiness
    const missing = (v) => v === undefined || v === null || v === '';
    if (!student_id || missing(amount_due) || missing(amount_paid) || !payment_method || !payment_date) {
      return sendError(res,
        'student_id, amount_due, amount_paid, payment_method, and payment_date are required.', 400);
    }
    const due = Number(amount_due), paid = Number(amount_paid);
    if (!Number.isFinite(due) || due < 0 || !Number.isFinite(paid) || paid < 0) {
      return sendError(res, 'amount_due and amount_paid must be numbers of 0 or more.', 400);
    }

    // Auto-get current academic year
    const currentYear = await getCurrentYear();
    if (!currentYear) {
      return sendError(res, 'No active academic year. Please activate one first.', 400);
    }

    // Valid enums
    const validMethods   = ['cash','bank_transfer','cbe_birr','telebirr','other'];
    // Must match the term_type and fee_category enums (migrations 006, 007, 012)
    const validTerms     = ['term1','term2','term3'];
    const validCategories = ['tuition','registration','material','exam',
                             'library','sport','uniform','transport','other'];

    if (!validMethods.includes(payment_method)) {
      return sendError(res, `payment_method must be: ${validMethods.join(', ')}`, 400);
    }
    // Omitted values keep their defaults; unknown values are rejected, not silently replaced
    if (term && !validTerms.includes(term)) {
      return sendError(res, `term must be: ${validTerms.join(', ')}`, 400);
    }
    if (category && !validCategories.includes(category)) {
      return sendError(res, `category must be: ${validCategories.join(', ')}`, 400);
    }

    const paymentTerm     = term     || 'term1';
    const paymentCategory = category || 'tuition';

    const receipt_number = genReceipt();

    const { rows } = await db.query(
      `INSERT INTO payments
         (student_id, fee_structure_id, academic_year_id, term, category,
          amount_due, amount_paid, payment_method, payment_date,
          receipt_number, reference, recorded_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        student_id,
        fee_structure_id || null,
        currentYear.id,
        paymentTerm,
        paymentCategory,
        parseFloat(amount_due),
        parseFloat(amount_paid),
        payment_method,
        payment_date,
        receipt_number,
        reference || null,
        req.user.id,
        notes || null,
      ]
    );

    return sendSuccess(res, rows[0],
      `Payment recorded. Receipt: ${receipt_number}`, 201);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/finance/payments — List payments
const getPayments = async (req, res) => {
  try {
    const { student_id, term } = req.query;
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);
    const { page, limit, offset } = pg;
    const conditions=[]; const params=[]; let idx=1;
    if (student_id) { conditions.push(`p.student_id=$${idx++}`); params.push(student_id); }
    if (term)       { conditions.push(`p.term=$${idx++}`);        params.push(term); }
    const where = conditions.length ? 'WHERE '+conditions.join(' AND ') : '';

    const { rows } = await db.query(
      `SELECT p.*,
         s.first_name||' '||s.last_name AS student_name,
         s.student_number,
         ay.name AS academic_year
       FROM payments p
       LEFT JOIN students       s  ON s.id=p.student_id
       LEFT JOIN academic_years ay ON ay.id=p.academic_year_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, parseInt(limit), offset]
    );

    const ct = await db.query(`SELECT COUNT(*) FROM payments p ${where}`, params);

    return sendSuccess(res, {
      payments: rows,
      pagination: {
        total: parseInt(ct.rows[0].count),
        page: parseInt(page), limit: parseInt(limit),
        totalPages: Math.ceil(parseInt(ct.rows[0].count)/parseInt(limit)),
      },
    }, `Found ${rows.length} payment(s).`);

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/finance/summary — Finance summary
const getFinanceSummary = async (req, res) => {
  try {
    const currentYear = await getCurrentYear();
    const yearFilter  = currentYear ? 'WHERE p.academic_year_id = $1' : '';
    const yearParams  = currentYear ? [currentYear.id] : [];

    const { rows: summary } = await db.query(
      `SELECT
         COALESCE(SUM(amount_due),0)  AS total_expected,
         COALESCE(SUM(amount_paid),0) AS total_collected,
         COALESCE(SUM(amount_due)-SUM(amount_paid),0) AS outstanding,
         -- same value under the name the dashboards read (was missing, so they showed 0)
         COALESCE(SUM(amount_due)-SUM(amount_paid),0) AS total_outstanding,
         ROUND(COALESCE(SUM(amount_paid),0)*100/
           NULLIF(COALESCE(SUM(amount_due),0),0),1) AS collection_rate,
         COUNT(DISTINCT student_id) AS paying_students
       FROM payments p ${yearFilter}`,
      yearParams
    );

    const { rows: byMethod } = await db.query(
      `SELECT payment_method, SUM(amount_paid) AS total, COUNT(*) AS count
       FROM payments p ${yearFilter}
       GROUP BY payment_method ORDER BY total DESC`,
      yearParams
    );

    const { rows: recent } = await db.query(
      `SELECT p.*,
         s.first_name||' '||s.last_name AS student_name,
         s.student_number
       FROM payments p
       LEFT JOIN students s ON s.id=p.student_id
       ${yearFilter}
       ORDER BY p.created_at DESC LIMIT 10`,
      yearParams
    );

    return sendSuccess(res, {
      summary:    summary[0],
      by_method:  byMethod,
      recent:     recent,
      year:       currentYear,
    }, 'Finance summary retrieved.');

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/finance/student/:studentId — Student balance
const getStudentBalance = async (req, res) => {
  try {
    const { studentId } = req.params;

    const { rows: payments } = await db.query(
      `SELECT p.*, ay.name AS academic_year
       FROM payments p
       LEFT JOIN academic_years ay ON ay.id=p.academic_year_id
       WHERE p.student_id=$1
       ORDER BY p.created_at DESC`, [studentId]
    );

    const totalDue  = payments.reduce((s,p)=>s+parseFloat(p.amount_due),0);
    const totalPaid = payments.reduce((s,p)=>s+parseFloat(p.amount_paid),0);

    return sendSuccess(res, {
      overview: {
        total_due:  totalDue,
        total_paid: totalPaid,
        balance:    totalDue - totalPaid,
        status:     totalDue<=totalPaid?'paid':totalPaid===0?'unpaid':'partial',
      },
      payments,
    }, 'Student balance retrieved.');

  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /api/finance/unpaid — Students with outstanding balance
const getUnpaidStudents = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.first_name||' '||s.last_name AS name,
              s.student_number, c.name AS class_name,
              SUM(p.amount_due)-SUM(p.amount_paid) AS balance
       FROM payments p
       JOIN students s ON s.id=p.student_id
       LEFT JOIN classes c ON c.id=s.class_id
       GROUP BY s.id, s.first_name, s.last_name, s.student_number, c.name
       HAVING SUM(p.amount_due) > SUM(p.amount_paid)
       ORDER BY balance DESC`
    );
    return sendSuccess(res, rows, `${rows.length} student(s) with outstanding balance.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

module.exports = {
  recordPayment, getPayments, getFinanceSummary,
  getStudentBalance, getUnpaidStudents,
};
