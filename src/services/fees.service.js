// src/services/fees.service.js
// ============================================================
// Monthly fees (M8, PHASE2_PLAN §5.3 B3). Money is whole santim here (utils/money.js).
//
// - Months follow the academic year: month 1 = Meskerem of the Ethiopian year the
//   academic year falls in (the year of its end date), ... 13 = Pagume.
// - A monthly charge is due on the fee's due day (default 10, D27) of its month,
//   capped at the last day of Pagume. A one-time fee is due on its own date (or no date).
// - Charges are generated for the whole year up front (parents may pay months in advance),
//   for active students in a class of the fee's year and grade. Generating twice adds nothing.
// - A discount (D22) is applied when a charge is generated, and recalculated on unpaid
//   amounts only: a paid charge never changes, and a discount never goes below what is
//   already paid on a charge.
// - Receipt numbers: RCP-<E.C. year of the payment date>-00001, one counter row per year,
//   taken inside the payment's transaction (row lock), so numbers have no gaps.
// ============================================================

const { toEthiopian, toGregorian, ethiopianMonthLength, academicYearEthiopian } = require('../utils/ethiopianDate');
const { toCents, fromCents, percentOf } = require('../utils/money');

const CATEGORIES = ['tuition', 'registration', 'material', 'exam', 'library', 'sport', 'uniform', 'transport', 'other'];
const METHODS = ['cash', 'telebirr', 'cbe_birr', 'mpesa', 'bank_transfer', 'other'];
const DISCOUNT_REASONS = ['sibling', 'staff_child', 'scholarship', 'other'];
const DEFAULT_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // Meskerem-Sene (D19)
const DEFAULT_DUE_DAY = 10;                              // D27

/** The Ethiopian year of an academic year row ({ end_date }). */
const ecYearOf = (year) => academicYearEthiopian(year.end_date);

/** Gregorian due date ('YYYY-MM-DD') of a monthly charge. */
const monthlyDueDate = (ecYear, month, dueDay) =>
  toGregorian({ year: ecYear, month, day: Math.min(dueDay, ethiopianMonthLength(ecYear, month)) });

/** The discount (santim) a student discount gives on one charge of amountCents; 0 outside its months. */
const discountCents = (discount, amountCents, month) => {
  if (!discount) return 0;
  if (month !== null && month !== undefined) {
    if (discount.from_month && month < discount.from_month) return 0;
    if (discount.to_month && month > discount.to_month) return 0;
  }
  const d = discount.kind === 'percent' ? percentOf(amountCents, discount.value) : toCents(discount.value);
  return Math.min(d, amountCents);
};

/** The charges a fee structure gives one student: [{ eth_month, due_date }]. */
const chargeSlots = (fee, ecYear) => (fee.frequency === 'monthly'
  ? [...fee.months].sort((a, b) => a - b).map((m) => ({ eth_month: m, due_date: monthlyDueDate(ecYear, m, fee.due_day) }))
  : [{ eth_month: null, due_date: fee.due_date ?? null }]);

/** Active students in a class of the fee's year (and grade, unless the fee is for all grades). */
const eligibleStudents = async (client, fee) => (await client.query(
  `SELECT s.id, c.grade_level FROM students s JOIN classes c ON c.id = s.class_id
   WHERE s.status = 'active' AND c.academic_year_id = $1 AND ($2::smallint IS NULL OR c.grade_level = $2)
   ORDER BY s.id`, [fee.academic_year_id, fee.grade_level])).rows;

/**
 * What generating charges for a fee structure would do (preview) or does (run):
 * { students, charges_new, charges_existing, amount_new, discount_new }.
 * Existing charges (any student, any month already there) are left as they are.
 */
const generateCharges = async (client, fee, { run = false, userId = null } = {}) => {
  const year = (await client.query('SELECT end_date FROM academic_years WHERE id = $1', [fee.academic_year_id])).rows[0];
  const slots = chargeSlots(fee, ecYearOf(year));
  const students = await eligibleStudents(client, fee);
  const ids = students.map((s) => s.id);
  const have = new Set((await client.query(
    `SELECT student_id, eth_month FROM student_charges WHERE fee_structure_id = $1 AND student_id = ANY($2::uuid[])`, [fee.id, ids]))
    .rows.map((r) => `${r.student_id}|${r.eth_month}`));
  const discounts = new Map((await client.query(
    'SELECT * FROM student_discounts WHERE fee_structure_id = $1 AND student_id = ANY($2::uuid[])', [fee.id, ids]))
    .rows.map((d) => [d.student_id, d]));
  const amount = toCents(fee.amount);
  const rows = [];
  let existing = 0;
  for (const s of students) {
    for (const slot of slots) {
      if (have.has(`${s.id}|${slot.eth_month}`)) { existing++; continue; }
      const d = discounts.get(s.id);
      rows.push({ student_id: s.id, ...slot, discount: discountCents(d, amount, slot.eth_month), discount_id: d?.id ?? null });
    }
  }
  if (run && rows.length) {
    await client.query(
      `INSERT INTO student_charges (student_id, academic_year_id, fee_structure_id, category, eth_month, amount_due,
                                    discount_amount, discount_id, due_date, created_by)
       SELECT x.student_id, $1, $2, $3, x.eth_month, $4, x.discount, x.discount_id, x.due_date, $5
       FROM jsonb_to_recordset($6::jsonb) AS x(student_id uuid, eth_month smallint, discount numeric, discount_id uuid, due_date date)
       ON CONFLICT DO NOTHING`,
      [fee.academic_year_id, fee.id, fee.category, fromCents(amount), userId,
        JSON.stringify(rows.map((r) => ({ ...r, discount: fromCents(r.discount) })))]);
  }
  return {
    students: students.length,
    months: slots.map((s) => s.eth_month).filter((m) => m !== null),
    charges_new: rows.length,
    charges_existing: existing,
    amount_new: fromCents(rows.length * amount),
    discount_new: fromCents(rows.reduce((a, r) => a + r.discount, 0)),
    net_new: fromCents(rows.length * amount - rows.reduce((a, r) => a + r.discount, 0)),
  };
};

/**
 * Recalculate the discount of a student's charges for one fee structure (after a discount
 * was added, changed or removed, or the fee's amount changed). Fully paid and waived charges
 * stay as they are; a discount never goes below what is already paid. Returns the charges changed.
 */
const recalcCharges = async (client, studentId, feeId, { amount = null } = {}) => {
  const discount = (await client.query(
    'SELECT * FROM student_discounts WHERE student_id = $1 AND fee_structure_id = $2', [studentId, feeId])).rows[0] ?? null;
  await client.query('SELECT id FROM student_charges WHERE student_id = $1 AND fee_structure_id = $2 FOR UPDATE', [studentId, feeId]);
  const charges = (await client.query(
    `SELECT id, eth_month, amount_due, discount_amount, discount_id, paid, status FROM student_charge_balances
     WHERE student_id = $1 AND fee_structure_id = $2`, [studentId, feeId])).rows;
  let changed = 0;
  for (const c of charges) {
    if (c.status === 'waived' || c.status === 'paid') continue;
    const paid = toCents(c.paid);
    const due = amount !== null && paid === 0 ? amount : toCents(c.amount_due);
    const disc = Math.min(discountCents(discount, due, c.eth_month), Math.max(due - paid, 0));
    const discId = disc > 0 ? discount.id : null;
    if (due === toCents(c.amount_due) && disc === toCents(c.discount_amount) && discId === c.discount_id) continue;
    await client.query('UPDATE student_charges SET amount_due = $2, discount_amount = $3, discount_id = $4 WHERE id = $1',
      [c.id, fromCents(due), fromCents(disc), discId]);
    changed++;
  }
  return changed;
};

/** The next receipt number for a payment date, inside the payment's transaction. */
const nextReceiptNumber = async (client, paymentDate) => {
  const ecYear = toEthiopian(paymentDate).year;
  const { rows } = await client.query(
    `INSERT INTO receipt_counters (eth_year, last_number) VALUES ($1, 1)
     ON CONFLICT (eth_year) DO UPDATE SET last_number = receipt_counters.last_number + 1
     RETURNING last_number`, [ecYear]);
  return `RCP-${ecYear}-${String(rows[0].last_number).padStart(5, '0')}`;
};

// Charges counted as owed now: due by today, or with no due date (one-time without a date,
// manual and legacy charges). Charges of later months are "upcoming".
const DUE_NOW = '(b.due_date IS NULL OR b.due_date <= CURRENT_DATE)';

/**
 * Totals over charges (PERMISSIONS decision 4), per student first so one student's
 * credit never hides another's debt:
 *   expected     = all charges after discounts (the whole year, also months not yet due)
 *   collected    = payments allocated to them (reversed payments not counted)
 *   outstanding  = what students owe now (sum of positive balances on charges due now)
 *   credit       = overpaid legacy charges (sum of negative balances, as a positive number)
 *   upcoming     = balance on charges not yet due (months ahead)
 *   overdue      = balance on charges whose due date has passed
 *   net_balance  = expected - collected = outstanding - credit + upcoming
 * `where` filters student_charge_balances b, e.g. 'b.academic_year_id = $1'.
 */
const totalsSql = (where = 'TRUE') => `
  WITH per_student AS (
    SELECT b.student_id,
           SUM(b.net_due) AS due, SUM(b.paid) AS paid,
           SUM(b.balance) FILTER (WHERE ${DUE_NOW}) AS now_balance,
           SUM(b.balance) FILTER (WHERE NOT ${DUE_NOW}) AS upcoming,
           SUM(GREATEST(b.balance, 0)) FILTER (WHERE b.due_date < CURRENT_DATE) AS overdue
    FROM student_charge_balances b WHERE ${where} GROUP BY b.student_id
  )
  SELECT COALESCE(SUM(due), 0)::numeric(14,2)                               AS total_expected,
         COALESCE(SUM(paid), 0)::numeric(14,2)                              AS total_collected,
         COALESCE(SUM(GREATEST(COALESCE(now_balance, 0), 0)), 0)::numeric(14,2) AS total_outstanding,
         COALESCE(SUM(GREATEST(-COALESCE(now_balance, 0), 0)), 0)::numeric(14,2) AS total_credit,
         COALESCE(SUM(upcoming), 0)::numeric(14,2)                          AS total_upcoming,
         COALESCE(SUM(overdue), 0)::numeric(14,2)                           AS total_overdue,
         (COALESCE(SUM(due), 0) - COALESCE(SUM(paid), 0))::numeric(14,2)    AS net_balance,
         ROUND(COALESCE(SUM(paid), 0) * 100 / NULLIF(COALESCE(SUM(due), 0), 0), 1) AS collection_rate,
         COUNT(*) FILTER (WHERE COALESCE(now_balance, 0) > 0)::int          AS students_owing,
         COUNT(*)::int                                                      AS students_charged
  FROM per_student`;

/** One student's totals: { total_due, total_paid, balance (owed now), upcoming, overdue, status }. */
const studentTotals = async (q, studentId, yearId = null) => {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(b.net_due), 0) AS total_due, COALESCE(SUM(b.paid), 0) AS total_paid,
            COALESCE(SUM(b.balance) FILTER (WHERE ${DUE_NOW}), 0) AS balance,
            COALESCE(SUM(b.balance) FILTER (WHERE NOT ${DUE_NOW}), 0) AS upcoming,
            COALESCE(SUM(GREATEST(b.balance, 0)) FILTER (WHERE b.due_date < CURRENT_DATE), 0) AS overdue,
            COUNT(*)::int AS charges
     FROM student_charge_balances b WHERE b.student_id = $1 AND ($2::uuid IS NULL OR b.academic_year_id = $2)`, [studentId, yearId]);
  const r = rows[0];
  const due = toCents(r.total_due), paid = toCents(r.total_paid), bal = toCents(r.balance);
  return {
    total_due: fromCents(due), total_paid: fromCents(paid), balance: fromCents(bal),
    upcoming: fromCents(toCents(r.upcoming)), overdue: fromCents(toCents(r.overdue)),
    status: !r.charges ? 'no_records' : bal <= 0 ? 'paid' : paid === 0 ? 'unpaid' : 'partial',
  };
};

module.exports = {
  CATEGORIES, METHODS, DISCOUNT_REASONS, DEFAULT_MONTHS, DEFAULT_DUE_DAY, DUE_NOW,
  ecYearOf, monthlyDueDate, discountCents, chargeSlots, generateCharges, recalcCharges,
  nextReceiptNumber, totalsSql, studentTotals,
};
