// src/controllers/finance.controller.js
// ============================================================
// Finance (M8, PHASE2_PLAN §5.3 B3): fee structures, charges per student and Ethiopian
// month, discounts, payments (receipts) allocated to charges, reversals, reports.
// Admin manages; principal reads (PERMISSIONS.md). Exact amounts: utils/money.js.
// The rules for months, due dates, discounts and receipt numbers: services/fees.service.js.
//
// The old frontend (finance.html, until M10) still posts the term shape to
// POST /payments ({ amount_due, amount_paid, term, category }): it becomes one charge
// without a month plus a payment for it, as the migrated payments (024).
// ============================================================

const db = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const { inTransaction } = require('../utils/transaction');
const { audit } = require('../utils/audit');
const { parseAmount, toCents, fromCents } = require('../utils/money');
const { toEthiopian } = require('../utils/ethiopianDate');
const F = require('../services/fees.service');

class FinanceError extends Error {
  constructor(message, status = 400, errors = null) { super(message); this.status = status; this.errors = errors; }
}
const fail = (res, err, what) => (err instanceof FinanceError
  ? sendError(res, err.message, err.status, err.errors)
  : sendServerError(res, err, what));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const text = (v, max) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const isMonth = (m) => Number.isInteger(m) && m >= 1 && m <= 13;

const getCurrentYear = async (q = db) => (await q.query(
  'SELECT id, name, start_date, end_date FROM academic_years WHERE is_current = TRUE LIMIT 1')).rows[0] || null;
const getYear = async (q, id) => (id
  ? (await q.query('SELECT id, name, start_date, end_date FROM academic_years WHERE id = $1', [id])).rows[0] || null
  : getCurrentYear(q));

// A fee structure as the API returns it
const FEE_COLUMNS = `f.id, f.academic_year_id, f.grade_level, f.category, f.frequency, f.amount, f.months, f.due_day,
  f.due_date, f.description, f.created_at, f.updated_at`;

// ══ Fee structures ═══════════════════════════════════════════

// GET /finance/fee-structures?academic_year_id=  (default: the current year)
const listFeeStructures = async (req, res) => {
  try {
    const year = await getYear(db, req.query.academic_year_id);
    if (!year) return sendSuccess(res, { year: null, fee_structures: [] }, 'No academic year.');
    const { rows } = await db.query(
      `SELECT ${FEE_COLUMNS},
              COUNT(b.id)::int AS charges, COUNT(DISTINCT b.student_id)::int AS students,
              COALESCE(SUM(b.net_due), 0) AS net_due, COALESCE(SUM(b.paid), 0) AS paid,
              COUNT(b.id) FILTER (WHERE b.paid > 0)::int AS charges_paid
       FROM fee_structures f LEFT JOIN student_charge_balances b ON b.fee_structure_id = f.id
       WHERE f.academic_year_id = $1
       GROUP BY f.id ORDER BY f.grade_level NULLS FIRST, f.category`, [year.id]);
    return sendSuccess(res, { year: { ...year, eth_year: F.ecYearOf(year) }, fee_structures: rows },
      `Found ${rows.length} fee structure(s).`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// The checked fields of a fee structure from the body; `cur` is the stored row for an update.
const feeInput = (body, cur = null) => {
  const has = (k) => body[k] !== undefined;
  const v = {
    grade_level: has('grade_level') ? body.grade_level : cur?.grade_level ?? null,
    category: has('category') ? body.category : cur?.category,
    frequency: has('frequency') ? body.frequency : cur?.frequency ?? 'monthly',
    amount: has('amount') ? parseAmount(body.amount) : toCents(cur?.amount),
    description: has('description') ? text(body.description, 200) : cur?.description ?? null,
  };
  if (v.grade_level === '' ) v.grade_level = null;
  if (v.grade_level !== null && !(Number.isInteger(Number(v.grade_level)) && v.grade_level >= 1 && v.grade_level <= 12)) {
    throw new FinanceError('grade_level must be 1-12, or null for all grades.');
  }
  if (v.grade_level !== null) v.grade_level = Number(v.grade_level);
  if (!F.CATEGORIES.includes(v.category)) throw new FinanceError(`category must be: ${F.CATEGORIES.join(', ')}`);
  if (!['monthly', 'one_time'].includes(v.frequency)) throw new FinanceError('frequency must be monthly or one_time.');
  if (!v.amount) throw new FinanceError('amount must be more than 0, with at most 2 decimals.');
  if (v.frequency === 'monthly') {
    const months = has('months') ? body.months : cur?.frequency === 'monthly' ? cur.months : F.DEFAULT_MONTHS;
    if (!Array.isArray(months) || !months.length || !months.every(isMonth) || new Set(months).size !== months.length) {
      throw new FinanceError('months must be a list of different Ethiopian months 1-13 (1 = Meskerem, 13 = Pagume).');
    }
    const dueDay = has('due_day') ? body.due_day : cur?.due_day ?? F.DEFAULT_DUE_DAY;
    if (!(Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 30)) throw new FinanceError('due_day must be 1-30.');
    Object.assign(v, { months: [...months].sort((a, b) => a - b), due_day: dueDay, due_date: null });
  } else {
    const dueDate = has('due_date') ? body.due_date || null : cur?.due_date ?? null;
    if (dueDate !== null && !isIsoDate(dueDate)) throw new FinanceError('due_date must be a date (YYYY-MM-DD).');
    Object.assign(v, { months: [], due_day: null, due_date: dueDate });
  }
  return v;
};

// One fee per category and grade; a fee for all grades and one for a single grade
// would charge the same students twice.
const checkOverlap = async (q, yearId, v, id = null) => {
  const { rows } = await q.query(
    `SELECT grade_level FROM fee_structures
     WHERE academic_year_id = $1 AND category = $2 AND id IS DISTINCT FROM $4
       AND (grade_level IS NOT DISTINCT FROM $3 OR grade_level IS NULL OR $3::smallint IS NULL) LIMIT 1`,
    [yearId, v.category, v.grade_level, id]);
  if (rows[0]) {
    throw new FinanceError(rows[0].grade_level === v.grade_level
      ? `A ${v.category} fee for ${v.grade_level ? `grade ${v.grade_level}` : 'all grades'} already exists in this year.`
      : `A ${v.category} fee for ${rows[0].grade_level ? `grade ${rows[0].grade_level}` : 'all grades'} already covers these students.`, 409);
  }
};

// POST /finance/fee-structures
const createFeeStructure = async (req, res) => {
  try {
    const year = await getYear(db, req.body.academic_year_id);
    if (!year) return sendError(res, 'No active academic year. Please activate one first.', 400);
    const v = feeInput(req.body);
    const row = await inTransaction(async (client) => {
      await checkOverlap(client, year.id, v);
      const { rows } = await client.query(
        `INSERT INTO fee_structures (academic_year_id, grade_level, category, frequency, amount, months, due_day, due_date, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [year.id, v.grade_level, v.category, v.frequency, fromCents(v.amount), v.months, v.due_day, v.due_date, v.description, req.user.id]);
      await audit(client, req, 'fee_structure.created', 'fee_structure', rows[0].id, { ...rows[0], year: year.name });
      return rows[0];
    });
    return sendSuccess(res, row, 'Fee structure created.', 201);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// PUT /finance/fee-structures/:id
// Amount and due day apply to charges already generated: the amount only to charges
// with nothing paid, the due day to every charge. Months can be added (generate again to
// charge them) and removed when nothing is paid in them. Grade, category and
// frequency are fixed once charges exist.
const updateFeeStructure = async (req, res) => {
  try {
    const out = await inTransaction(async (client) => {
      const cur = (await client.query('SELECT * FROM fee_structures WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      const v = feeInput(req.body, cur);
      const charges = (await client.query(
        `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE paid > 0)::int paid FROM student_charge_balances WHERE fee_structure_id = $1`, [cur.id])).rows[0];
      if (charges.n && (v.grade_level !== cur.grade_level || v.category !== cur.category || v.frequency !== cur.frequency)) {
        throw new FinanceError('Grade, category and frequency cannot change once charges exist. Delete the unpaid charges first (delete the fee structure) or add a new one.', 409);
      }
      await checkOverlap(client, cur.academic_year_id, v, cur.id);
      const removed = cur.months.filter((m) => !v.months.includes(m));
      if (removed.length) {
        const paidIn = (await client.query(
          `SELECT DISTINCT eth_month FROM student_charge_balances WHERE fee_structure_id = $1 AND eth_month = ANY($2) AND paid > 0 ORDER BY 1`,
          [cur.id, removed])).rows.map((r) => r.eth_month);
        if (paidIn.length) throw new FinanceError(`Months ${paidIn.join(', ')} have payments and cannot be removed.`, 409, { months: paidIn });
      }
      const { rows } = await client.query(
        `UPDATE fee_structures SET grade_level = $2, category = $3, frequency = $4, amount = $5, months = $6, due_day = $7,
           due_date = $8, description = $9, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [cur.id, v.grade_level, v.category, v.frequency, fromCents(v.amount), v.months, v.due_day, v.due_date, v.description]);
      const fee = rows[0];
      const effect = { removed_charges: 0, amount_changed: 0, due_dates_changed: 0 };
      if (removed.length) {
        effect.removed_charges = (await client.query(
          `DELETE FROM student_charges c WHERE c.fee_structure_id = $1 AND c.eth_month = ANY($2)
             AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.charge_id = c.id)`, [cur.id, removed])).rowCount;
      }
      if (v.amount !== toCents(cur.amount)) {
        const students = (await client.query('SELECT DISTINCT student_id FROM student_charges WHERE fee_structure_id = $1', [cur.id])).rows;
        for (const s of students) effect.amount_changed += await F.recalcCharges(client, s.student_id, cur.id, { amount: v.amount });
      }
      if (v.due_day !== cur.due_day || v.due_date !== cur.due_date) {
        const year = (await client.query('SELECT end_date FROM academic_years WHERE id = $1', [cur.academic_year_id])).rows[0];
        for (const slot of F.chargeSlots(fee, F.ecYearOf(year))) {
          effect.due_dates_changed += (await client.query(
            'UPDATE student_charges SET due_date = $3 WHERE fee_structure_id = $1 AND eth_month IS NOT DISTINCT FROM $2 AND due_date IS DISTINCT FROM $3',
            [cur.id, slot.eth_month, slot.due_date])).rowCount;
        }
      }
      await audit(client, req, 'fee_structure.updated', 'fee_structure', cur.id, { ...fee, ...effect }, cur);
      return { ...fee, ...effect };
    });
    return sendSuccess(res, out, 'Fee structure updated.');
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// DELETE /finance/fee-structures/:id — with its charges, as long as nothing was ever paid on them
const deleteFeeStructure = async (req, res) => {
  try {
    const out = await inTransaction(async (client) => {
      const cur = (await client.query('SELECT * FROM fee_structures WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      const paid = (await client.query(
        `SELECT COUNT(DISTINCT a.charge_id)::int n FROM payment_allocations a JOIN student_charges c ON c.id = a.charge_id
         WHERE c.fee_structure_id = $1`, [cur.id])).rows[0].n;
      if (paid) throw new FinanceError(`${paid} charge(s) of this fee have payments (also reversed ones), so it cannot be deleted. Change its amount or waive single charges instead.`, 409);
      const charges = (await client.query('DELETE FROM student_charges WHERE fee_structure_id = $1', [cur.id])).rowCount;
      const discounts = (await client.query('DELETE FROM student_discounts WHERE fee_structure_id = $1', [cur.id])).rowCount;
      await client.query('DELETE FROM fee_structures WHERE id = $1', [cur.id]);
      await audit(client, req, 'fee_structure.deleted', 'fee_structure', cur.id, { charges, discounts }, cur);
      return { charges, discounts };
    });
    return sendSuccess(res, out, `Fee structure deleted with ${out.charges} unpaid charge(s).`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// GET (preview) / POST (run) /finance/fee-structures/:id/generate
const generateCharges = async (req, res) => {
  const run = req.method === 'POST';
  try {
    const out = await inTransaction(async (client) => {
      const fee = (await client.query(`SELECT * FROM fee_structures WHERE id = $1 ${run ? 'FOR UPDATE' : ''}`, [req.params.id])).rows[0];
      const r = await F.generateCharges(client, fee, { run, userId: req.user.id });
      if (run && r.charges_new) {
        await audit(client, req, 'fee_structure.charges_generated', 'fee_structure', fee.id,
          { category: fee.category, grade_level: fee.grade_level, ...r });
      }
      return r;
    });
    return sendSuccess(res, { ...out, preview: !run },
      run ? `${out.charges_new} charge(s) created.` : `${out.charges_new} charge(s) would be created.`, run && out.charges_new ? 201 : 200);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// ══ Charges ═════════════════════════════════════════════════

const CHARGE_COLUMNS = `b.id, b.student_id, b.academic_year_id, b.fee_structure_id, b.category, b.eth_month, b.amount_due,
  b.discount_amount, b.discount_id, b.net_due, b.paid, b.balance, b.status, b.due_date, b.description, b.legacy_term,
  b.waived_at, b.waive_reason, b.created_at,
  (b.due_date < CURRENT_DATE AND b.balance > 0) AS overdue`;

// GET /finance/charges?student_id=&academic_year_id=&eth_month=&class_id=&status=&category=
const listCharges = async (req, res) => {
  try {
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);
    const { student_id, academic_year_id, eth_month, class_id, status, category } = req.query;
    const cond = []; const params = [];
    const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
    if (student_id) add('b.student_id = ?', student_id);
    if (academic_year_id) add('b.academic_year_id = ?', academic_year_id);
    if (eth_month) {
      if (!isMonth(Number(eth_month))) return sendError(res, 'eth_month must be 1-13.', 400);
      add('b.eth_month = ?', Number(eth_month));
    }
    if (class_id) add('s.class_id = ?', class_id);
    if (status) {
      if (!['paid', 'partial', 'unpaid', 'waived', 'open', 'overdue'].includes(status)) return sendError(res, 'status must be paid, partial, unpaid, waived, open or overdue.', 400);
      if (status === 'open') cond.push('b.balance > 0');
      else if (status === 'overdue') cond.push('b.balance > 0 AND b.due_date < CURRENT_DATE');
      else add('b.status = ?', status);
    }
    if (category) add('b.category = ?', category);
    for (const id of [student_id, academic_year_id, class_id].filter(Boolean)) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return sendError(res, 'Invalid id.', 400);
    }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT ${CHARGE_COLUMNS}, s.first_name || ' ' || s.last_name AS student_name, s.student_number
       FROM student_charge_balances b JOIN students s ON s.id = b.student_id ${where}
       ORDER BY s.first_name, s.last_name, b.eth_month NULLS LAST, b.category
       LIMIT ${pg.limit} OFFSET ${pg.offset}`, params);
    const total = (await db.query(`SELECT COUNT(*)::int n FROM student_charge_balances b JOIN students s ON s.id = b.student_id ${where}`, params)).rows[0].n;
    return sendSuccess(res, { charges: rows, pagination: { total, page: pg.page, limit: pg.limit, totalPages: Math.ceil(total / pg.limit) } },
      `Found ${rows.length} charge(s).`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// POST /finance/charges — a single charge outside the fee structures (e.g. a lost book)
const createCharge = async (req, res) => {
  try {
    const { student_id, category, eth_month = null, due_date = null } = req.body;
    if (!student_id) return sendError(res, 'student_id is required.', 400);
    if (!F.CATEGORIES.includes(category)) return sendError(res, `category must be: ${F.CATEGORIES.join(', ')}`, 400);
    const amount = parseAmount(req.body.amount);
    if (!amount) return sendError(res, 'amount must be more than 0, with at most 2 decimals.', 400);
    if (eth_month !== null && !isMonth(eth_month)) return sendError(res, 'eth_month must be 1-13.', 400);
    if (due_date !== null && !isIsoDate(due_date)) return sendError(res, 'due_date must be a date (YYYY-MM-DD).', 400);
    const description = text(req.body.description, 200);
    if (!description) return sendError(res, 'description is required (what the charge is for).', 400);
    const row = await inTransaction(async (client) => {
      const year = req.body.academic_year_id
        ? await getYear(client, req.body.academic_year_id)
        : (await client.query(
          `SELECT ay.id, ay.name, ay.end_date FROM students s JOIN classes c ON c.id = s.class_id JOIN academic_years ay ON ay.id = c.academic_year_id
           WHERE s.id = $1`, [student_id])).rows[0] || await getCurrentYear(client);
      if (!year) throw new FinanceError('No academic year for this charge.');
      const due = due_date ?? (eth_month ? F.monthlyDueDate(F.ecYearOf(year), eth_month, F.DEFAULT_DUE_DAY) : null);
      const { rows } = await client.query(
        `INSERT INTO student_charges (student_id, academic_year_id, category, eth_month, amount_due, due_date, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [student_id, year.id, category, eth_month, fromCents(amount), due, description, req.user.id]);
      await audit(client, req, 'charge.created', 'charge', rows[0].id, { ...rows[0], year: year.name });
      return rows[0];
    });
    return sendSuccess(res, row, 'Charge added.', 201);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// POST /finance/charges/:id/waive { reason } — what is left of the charge is no longer owed
const waiveCharge = async (req, res) => {
  try {
    const reason = text(req.body.reason, 500);
    if (!reason) return sendError(res, 'reason is required.', 400);
    const row = await inTransaction(async (client) => {
      await client.query('SELECT id FROM student_charges WHERE id = $1 FOR UPDATE', [req.params.id]);
      const cur = (await client.query('SELECT * FROM student_charge_balances WHERE id = $1', [req.params.id])).rows[0];
      if (cur.status === 'waived') throw new FinanceError('This charge is already waived.', 409);
      if (cur.status === 'paid') throw new FinanceError('This charge is paid; nothing to waive.', 409);
      await client.query('UPDATE student_charges SET waived_at = NOW(), waived_by = $2, waive_reason = $3 WHERE id = $1', [cur.id, req.user.id, reason]);
      await audit(client, req, 'charge.waived', 'charge', cur.id,
        { reason, waived: cur.balance, student_id: cur.student_id, category: cur.category, eth_month: cur.eth_month },
        { net_due: cur.net_due, paid: cur.paid, balance: cur.balance });
      return (await client.query(`SELECT ${CHARGE_COLUMNS} FROM student_charge_balances b WHERE b.id = $1`, [cur.id])).rows[0];
    });
    return sendSuccess(res, row, 'Charge waived.');
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// ══ Discounts (D22) ═════════════════════════════════════════

const discountInput = (body, cur = null) => {
  const has = (k) => body[k] !== undefined;
  const v = {
    kind: has('kind') ? body.kind : cur?.kind,
    reason: has('reason') ? body.reason : cur?.reason,
    note: has('note') ? text(body.note, 500) : cur?.note ?? null,
    from_month: has('from_month') ? body.from_month : cur?.from_month ?? null,
    to_month: has('to_month') ? body.to_month : cur?.to_month ?? null,
  };
  if (!['percent', 'amount'].includes(v.kind)) throw new FinanceError('kind must be percent or amount.');
  const value = has('value') ? parseAmount(body.value) : toCents(cur?.value);
  if (!value || (v.kind === 'percent' && value > 10000)) {
    throw new FinanceError(v.kind === 'percent' ? 'value must be a percentage above 0 and up to 100.' : 'value must be an amount above 0 (ETB per charge).');
  }
  v.value = fromCents(value);
  if (!F.DISCOUNT_REASONS.includes(v.reason)) throw new FinanceError(`reason must be: ${F.DISCOUNT_REASONS.join(', ')}`);
  if (v.reason === 'other' && !v.note) throw new FinanceError('A note is required when the reason is "other".');
  for (const k of ['from_month', 'to_month']) {
    if (v[k] !== null && !isMonth(v[k])) throw new FinanceError(`${k} must be 1-13.`);
  }
  if (v.from_month && v.to_month && v.from_month > v.to_month) throw new FinanceError('from_month must not be after to_month.');
  return v;
};

// GET /finance/discounts?student_id=&fee_structure_id=&academic_year_id=
const listDiscounts = async (req, res) => {
  try {
    const { student_id, fee_structure_id, academic_year_id } = req.query;
    for (const id of [student_id, fee_structure_id, academic_year_id].filter(Boolean)) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return sendError(res, 'Invalid id.', 400);
    }
    const { rows } = await db.query(
      `SELECT d.*, s.first_name || ' ' || s.last_name AS student_name, s.student_number,
              f.category, f.grade_level, f.frequency, f.amount AS fee_amount, f.academic_year_id,
              (SELECT COALESCE(SUM(c.discount_amount), 0) FROM student_charges c WHERE c.discount_id = d.id) AS discount_total
       FROM student_discounts d JOIN students s ON s.id = d.student_id JOIN fee_structures f ON f.id = d.fee_structure_id
       WHERE ($1::uuid IS NULL OR d.student_id = $1) AND ($2::uuid IS NULL OR d.fee_structure_id = $2)
         AND ($3::uuid IS NULL OR f.academic_year_id = $3)
       ORDER BY s.first_name, s.last_name, f.category`, [student_id || null, fee_structure_id || null, academic_year_id || null]);
    return sendSuccess(res, rows, `Found ${rows.length} discount(s).`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// POST /finance/discounts — one per student and fee; recalculates that student's unpaid charges
const createDiscount = async (req, res) => {
  try {
    const { student_id, fee_structure_id } = req.body;
    if (!student_id || !fee_structure_id) return sendError(res, 'student_id and fee_structure_id are required.', 400);
    const v = discountInput(req.body);
    const out = await inTransaction(async (client) => {
      if ((await client.query('SELECT 1 FROM student_discounts WHERE student_id = $1 AND fee_structure_id = $2', [student_id, fee_structure_id])).rows[0]) {
        throw new FinanceError('This student already has a discount on this fee. Change that one instead.', 409);
      }
      const { rows } = await client.query(
        `INSERT INTO student_discounts (student_id, fee_structure_id, kind, value, reason, note, from_month, to_month, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [student_id, fee_structure_id, v.kind, v.value, v.reason, v.note, v.from_month, v.to_month, req.user.id]);
      const changed = await F.recalcCharges(client, student_id, fee_structure_id);
      await audit(client, req, 'discount.created', 'discount', rows[0].id, { ...rows[0], charges_changed: changed });
      return { ...rows[0], charges_changed: changed };
    });
    return sendSuccess(res, out, `Discount saved; ${out.charges_changed} charge(s) recalculated.`, 201);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// PUT /finance/discounts/:id
const updateDiscount = async (req, res) => {
  try {
    const out = await inTransaction(async (client) => {
      const cur = (await client.query('SELECT * FROM student_discounts WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      const v = discountInput(req.body, cur);
      const { rows } = await client.query(
        `UPDATE student_discounts SET kind = $2, value = $3, reason = $4, note = $5, from_month = $6, to_month = $7, updated_at = NOW()
         WHERE id = $1 RETURNING *`, [cur.id, v.kind, v.value, v.reason, v.note, v.from_month, v.to_month]);
      const changed = await F.recalcCharges(client, cur.student_id, cur.fee_structure_id);
      await audit(client, req, 'discount.updated', 'discount', cur.id, { ...rows[0], charges_changed: changed }, cur);
      return { ...rows[0], charges_changed: changed };
    });
    return sendSuccess(res, out, `Discount saved; ${out.charges_changed} charge(s) recalculated.`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// DELETE /finance/discounts/:id — unpaid charges go back to the full amount; paid ones keep theirs
const deleteDiscount = async (req, res) => {
  try {
    const out = await inTransaction(async (client) => {
      const cur = (await client.query('SELECT * FROM student_discounts WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      await client.query('DELETE FROM student_discounts WHERE id = $1', [cur.id]);
      const changed = await F.recalcCharges(client, cur.student_id, cur.fee_structure_id);
      await audit(client, req, 'discount.deleted', 'discount', cur.id, { student_id: cur.student_id, charges_changed: changed }, cur);
      return { charges_changed: changed };
    });
    return sendSuccess(res, out, `Discount removed; ${out.charges_changed} charge(s) recalculated.`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// ══ Payments ════════════════════════════════════════════════

// The payment's own fields, shared by both shapes
const paymentInput = (body) => {
  const { payment_method, payment_date } = body;
  if (!F.METHODS.includes(payment_method)) throw new FinanceError(`payment_method must be: ${F.METHODS.join(', ')}`);
  if (!isIsoDate(payment_date)) throw new FinanceError('payment_date must be a date (YYYY-MM-DD).');
  if (payment_date > todayIso()) throw new FinanceError('payment_date cannot be in the future.');
  const reference = text(body.reference, 100);
  if (payment_method !== 'cash' && !reference) {
    throw new FinanceError('reference is required for payments other than cash (transaction or bank reference).');
  }
  return { payment_method, payment_date, reference, notes: text(body.notes, 500) };
};

const insertPayment = async (client, req, studentId, yearId, amount, p, legacy = null) => {
  const receipt = await F.nextReceiptNumber(client, p.payment_date);
  const { rows } = await client.query(
    `INSERT INTO payments (student_id, academic_year_id, term, category, amount_due, amount_paid, amount,
                           payment_method, payment_date, receipt_number, reference, recorded_by, notes, fee_structure_id)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [studentId, yearId, legacy?.term ?? null, legacy?.category ?? null, legacy ? fromCents(legacy.due) : null, fromCents(amount),
      p.payment_method, p.payment_date, receipt, p.reference, req.user.id, p.notes, legacy?.fee_structure_id ?? null]);
  return rows[0];
};

// POST /finance/payments
//   { student_id, payment_date, payment_method, reference?, notes?, allocations: [{ charge_id, amount }] }
//   One receipt for several charges (e.g. three months of tuition and transport). Each amount at
//   most what is open on the charge: no overpayment. All charges of one student and one year.
// Old frontend: { student_id, amount_due, amount_paid, payment_method, payment_date, term?, category? }
const recordPayment = async (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return sendError(res, 'student_id is required.', 400);
    if (!Array.isArray(req.body.allocations) && (req.body.amount_due !== undefined || req.body.amount_paid !== undefined)) {
      return await recordLegacyShape(req, res);
    }
    const p = paymentInput(req.body);
    const list = req.body.allocations;
    if (!Array.isArray(list) || !list.length) return sendError(res, 'allocations is required: [{ charge_id, amount }].', 400);
    const want = new Map();
    for (const [i, a] of list.entries()) {
      const amount = parseAmount(a?.amount);
      if (!a?.charge_id || !/^[0-9a-f-]{36}$/i.test(a.charge_id)) return sendError(res, `allocations[${i}].charge_id does not exist.`, 400, { field: `allocations[${i}].charge_id` });
      if (!amount) return sendError(res, `allocations[${i}].amount must be more than 0, with at most 2 decimals.`, 400);
      if (want.has(a.charge_id)) return sendError(res, `allocations[${i}]: the same charge twice.`, 400);
      want.set(a.charge_id, amount);
    }
    const out = await inTransaction(async (client) => {
      // Lock the charges, so two payments cannot both take what is left on one
      const locked = (await client.query('SELECT id FROM student_charges WHERE id = ANY($1::uuid[]) AND student_id = $2 FOR UPDATE',
        [[...want.keys()], student_id])).rows;
      if (locked.length !== want.size) throw new FinanceError('Some charges do not exist or belong to another student.', 400, { field: 'allocations' });
      const charges = (await client.query('SELECT * FROM student_charge_balances WHERE id = ANY($1::uuid[])', [[...want.keys()]])).rows;
      if (new Set(charges.map((c) => c.academic_year_id)).size > 1) throw new FinanceError('One payment covers charges of one academic year.');
      const over = [];
      for (const c of charges) {
        if (c.status === 'waived') throw new FinanceError('A waived charge cannot be paid.', 409, { charge_id: c.id });
        if (want.get(c.id) > toCents(c.balance)) over.push({ charge_id: c.id, open: c.balance, amount: fromCents(want.get(c.id)) });
      }
      if (over.length) throw new FinanceError('An amount is more than what is open on its charge (no overpayment).', 409, { over });
      const total = [...want.values()].reduce((a, b) => a + b, 0);
      const pay = await insertPayment(client, req, student_id, charges[0].academic_year_id, total, p);
      for (const [charge, amount] of want) {
        await client.query('INSERT INTO payment_allocations (payment_id, charge_id, amount) VALUES ($1, $2, $3)', [pay.id, charge, fromCents(amount)]);
      }
      await audit(client, req, 'payment.recorded', 'payment', pay.id, {
        receipt_number: pay.receipt_number, student_id, amount: pay.amount, payment_method: p.payment_method,
        allocations: charges.map((c) => ({ charge_id: c.id, category: c.category, eth_month: c.eth_month, amount: fromCents(want.get(c.id)) })),
      });
      return pay.id;
    });
    const receipt = await loadReceipt(db, out);
    return sendSuccess(res, receipt, `Payment recorded. Receipt: ${receipt.receipt_number}`, 201);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// The old term shape: one charge without a month (amount_due) and a payment for it (amount_paid)
const recordLegacyShape = async (req, res) => {
  const { student_id, amount_due, amount_paid, term, category, fee_structure_id } = req.body;
  const missing = (v) => v === undefined || v === null || v === '';
  if (missing(amount_due) || missing(amount_paid) || !req.body.payment_method || !req.body.payment_date) {
    return sendError(res, 'student_id, amount_due, amount_paid, payment_method, and payment_date are required.', 400);
  }
  const due = parseAmount(amount_due), paid = parseAmount(amount_paid);
  if (due === null || paid === null) return sendError(res, 'amount_due and amount_paid must be numbers of 0 or more.', 400);
  if (term && !['term1', 'term2', 'term3'].includes(term)) return sendError(res, 'term must be: term1, term2, term3', 400);
  if (category && !F.CATEGORIES.includes(category)) return sendError(res, `category must be: ${F.CATEGORIES.join(', ')}`, 400);
  if (paid > due) return sendError(res, 'amount_paid is more than amount_due (no overpayment).', 409);
  const p = paymentInput(req.body);
  const year = await getCurrentYear();
  if (!year) return sendError(res, 'No active academic year. Please activate one first.', 400);
  const legacy = { term: term || 'term1', category: category || 'tuition', due, fee_structure_id: fee_structure_id || null };
  const out = await inTransaction(async (client) => {
    const { rows: [charge] } = await client.query(
      `INSERT INTO student_charges (student_id, academic_year_id, category, amount_due, legacy_term, description, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Recorded on the old finance page', $6) RETURNING *`,
      [student_id, year.id, legacy.category, fromCents(due), legacy.term, req.user.id]);
    let pay = null;
    if (paid > 0) {
      pay = await insertPayment(client, req, student_id, year.id, paid, p, legacy);
      await client.query('INSERT INTO payment_allocations (payment_id, charge_id, amount) VALUES ($1, $2, $3)', [pay.id, charge.id, fromCents(paid)]);
    }
    await audit(client, req, 'payment.recorded', pay ? 'payment' : 'charge', pay?.id ?? charge.id,
      { receipt_number: pay?.receipt_number ?? null, student_id, amount_due: fromCents(due), amount: fromCents(paid), term: legacy.term, category: legacy.category, old_page: true });
    return pay ?? { ...charge, receipt_number: null, amount_paid: '0.00', payment_method: p.payment_method, payment_date: p.payment_date };
  });
  return sendSuccess(res, out, out.receipt_number ? `Payment recorded. Receipt: ${out.receipt_number}` : 'Charge recorded (nothing paid).', 201);
};

// A receipt: the payment, the student, what it paid, the reversal if any
const loadReceipt = async (q, id) => {
  const { rows: [p] } = await q.query(
    `SELECT p.id, p.receipt_number, p.payment_date, p.payment_method, p.reference, p.amount, p.notes, p.created_at,
            p.reversed_at, p.reversal_reason, p.academic_year_id, ay.name AS academic_year, ay.end_date AS academic_year_end,
            s.id AS student_id, s.student_number, s.first_name, s.last_name, s.fathers_name,
            s.first_name_am, s.fathers_name_am, s.last_name_am, c.name AS class_name,
            COALESCE(ru.display_name, ru.email) AS recorded_by_name, COALESCE(vu.display_name, vu.email) AS reversed_by_name
     FROM payments p JOIN students s ON s.id = p.student_id
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN academic_years ay ON ay.id = p.academic_year_id
     LEFT JOIN users ru ON ru.id = p.recorded_by
     LEFT JOIN users vu ON vu.id = p.reversed_by
     WHERE p.id = $1`, [id]);
  if (!p) return null;
  const { rows: lines } = await q.query(
    `SELECT a.charge_id, a.amount, c.category, c.eth_month, c.legacy_term, c.description, c.due_date,
            c.amount_due, c.discount_amount
     FROM payment_allocations a JOIN student_charges c ON c.id = a.charge_id
     WHERE a.payment_id = $1 ORDER BY c.eth_month NULLS LAST, c.category`, [id]);
  return { ...p, eth_year: toEthiopian(p.payment_date)?.year ?? null, status: p.reversed_at ? 'reversed' : 'valid', lines };
};

// GET /finance/payments?student_id=&academic_year_id=&from=&to=&method=&status=valid|reversed
const getPayments = async (req, res) => {
  try {
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);
    const { student_id, academic_year_id, from, to, method, status, term } = req.query;
    const cond = []; const params = [];
    const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
    for (const id of [student_id, academic_year_id].filter(Boolean)) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return sendError(res, 'Invalid id.', 400);
    }
    if (student_id) add('p.student_id = ?', student_id);
    if (academic_year_id) add('p.academic_year_id = ?', academic_year_id);
    if (from) { if (!isIsoDate(from)) return sendError(res, 'from must be a date.', 400); add('p.payment_date >= ?', from); }
    if (to) { if (!isIsoDate(to)) return sendError(res, 'to must be a date.', 400); add('p.payment_date <= ?', to); }
    if (method) { if (!F.METHODS.includes(method)) return sendError(res, 'Unknown payment method.', 400); add('p.payment_method = ?', method); }
    if (status === 'valid') cond.push('p.reversed_at IS NULL');
    else if (status === 'reversed') cond.push('p.reversed_at IS NOT NULL');
    if (term) add('p.term = ?', term);
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT p.*, s.first_name || ' ' || s.last_name AS student_name, s.student_number, ay.name AS academic_year,
              CASE WHEN p.reversed_at IS NULL THEN 'valid' ELSE 'reversed' END AS status,
              (SELECT json_agg(json_build_object('charge_id', a.charge_id, 'amount', a.amount, 'category', c.category,
                       'eth_month', c.eth_month, 'legacy_term', c.legacy_term) ORDER BY c.eth_month NULLS LAST, c.category)
               FROM payment_allocations a JOIN student_charges c ON c.id = a.charge_id WHERE a.payment_id = p.id) AS lines
       FROM payments p
       LEFT JOIN students s ON s.id = p.student_id
       LEFT JOIN academic_years ay ON ay.id = p.academic_year_id
       ${where}
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pg.limit, pg.offset]);
    const total = (await db.query(`SELECT COUNT(*)::int n FROM payments p ${where}`, params)).rows[0].n;
    return sendSuccess(res, {
      payments: rows,
      pagination: { total, page: pg.page, limit: pg.limit, totalPages: Math.ceil(total / pg.limit) },
    }, `Found ${rows.length} payment(s).`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// GET /finance/payments/:id — the receipt
const getPayment = async (req, res) => {
  try {
    return sendSuccess(res, await loadReceipt(db, req.params.id), 'Receipt retrieved.');
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// POST /finance/payments/:id/reverse { reason } — a correction: the receipt keeps its number,
// shows "Reversed", and its amounts no longer count; the charges are open again.
const reversePayment = async (req, res) => {
  try {
    const reason = text(req.body.reason, 500);
    if (!reason) return sendError(res, 'reason is required.', 400);
    await inTransaction(async (client) => {
      const cur = (await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      if (cur.reversed_at) throw new FinanceError('This payment is already reversed.', 409);
      await client.query('UPDATE payments SET reversed_at = NOW(), reversed_by = $2, reversal_reason = $3 WHERE id = $1', [cur.id, req.user.id, reason]);
      await audit(client, req, 'payment.reversed', 'payment', cur.id,
        { reason, receipt_number: cur.receipt_number, student_id: cur.student_id, amount: cur.amount },
        { receipt_number: cur.receipt_number, amount: cur.amount, payment_date: cur.payment_date, payment_method: cur.payment_method });
    });
    return sendSuccess(res, await loadReceipt(db, req.params.id), 'Payment reversed.');
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// ══ Reports ═════════════════════════════════════════════════

// GET /finance/summary?academic_year_id=  (default: the current year)
// summary: PERMISSIONS decision 4 (fees.service totalsSql); by_month: per Ethiopian month
const getFinanceSummary = async (req, res) => {
  try {
    const year = await getYear(db, req.query.academic_year_id);
    const where = year ? 'b.academic_year_id = $1' : 'FALSE';
    const params = year ? [year.id] : [];
    const { rows: [summary] } = await db.query(F.totalsSql(where), params);
    summary.outstanding = summary.total_outstanding;          // kept for existing clients
    summary.paying_students = summary.students_charged;       // kept for existing clients
    const { rows: byMonth } = await db.query(
      `SELECT b.eth_month, MIN(b.due_date) AS due_date, SUM(b.net_due) AS expected, SUM(b.paid) AS collected,
              SUM(GREATEST(b.balance, 0)) AS open, COUNT(*) FILTER (WHERE b.balance > 0)::int AS charges_open,
              COUNT(DISTINCT b.student_id) FILTER (WHERE b.balance > 0)::int AS students_open
       FROM student_charge_balances b WHERE ${where} AND b.eth_month IS NOT NULL GROUP BY b.eth_month ORDER BY b.eth_month`, params);
    const { rows: other } = await db.query(
      `SELECT CASE WHEN b.legacy_term IS NOT NULL THEN 'legacy' ELSE 'one_time' END AS kind,
              SUM(b.net_due) AS expected, SUM(b.paid) AS collected, SUM(GREATEST(b.balance, 0)) AS open
       FROM student_charge_balances b WHERE ${where} AND b.eth_month IS NULL GROUP BY 1 ORDER BY 1`, params);
    const { rows: byMethod } = await db.query(
      `SELECT payment_method, SUM(amount) AS total, COUNT(*)::int AS count
       FROM payments p WHERE ${year ? 'p.academic_year_id = $1' : 'FALSE'} AND p.reversed_at IS NULL
       GROUP BY payment_method ORDER BY total DESC`, params);
    const { rows: recent } = await db.query(
      `SELECT p.*, s.first_name || ' ' || s.last_name AS student_name, s.student_number,
              CASE WHEN p.reversed_at IS NULL THEN 'valid' ELSE 'reversed' END AS status
       FROM payments p LEFT JOIN students s ON s.id = p.student_id
       WHERE ${year ? 'p.academic_year_id = $1' : 'FALSE'}
       ORDER BY p.created_at DESC LIMIT 10`, params);
    return sendSuccess(res, {
      summary, by_month: byMonth, other, by_method: byMethod, recent,
      year: year ? { ...year, eth_year: F.ecYearOf(year) } : null,
    }, 'Finance summary retrieved.');
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// GET /finance/outstanding?academic_year_id=&eth_month=&class_id=&scope=due|all
// Who owes what, by class and student. scope=due (default): charges due by today (legacy and
// one-time without a date included); scope=all: also months not yet due. eth_month: that month only.
const getOutstanding = async (req, res) => {
  try {
    const year = await getYear(db, req.query.academic_year_id);
    if (!year) return sendSuccess(res, { year: null, classes: [], students: [] }, 'No academic year.');
    const { class_id } = req.query;
    if (class_id && !/^[0-9a-f-]{36}$/i.test(class_id)) return sendError(res, 'Invalid id.', 400);
    const scope = req.query.scope || 'due';
    if (!['due', 'all'].includes(scope)) return sendError(res, 'scope must be due or all.', 400);
    const month = req.query.eth_month ? Number(req.query.eth_month) : null;
    if (month !== null && !isMonth(month)) return sendError(res, 'eth_month must be 1-13.', 400);
    const params = [year.id, month, class_id || null];
    const filter = `b.academic_year_id = $1 AND ($2::smallint IS NULL OR b.eth_month = $2) AND ($3::uuid IS NULL OR s.class_id = $3)
      ${scope === 'due' && month === null ? `AND ${F.DUE_NOW}` : ''}`;
    const { rows: students } = await db.query(
      `SELECT s.id AS student_id, s.student_number, s.first_name || ' ' || s.last_name AS name,
              s.first_name_am, s.fathers_name_am, s.last_name_am, s.status AS student_status,
              c.id AS class_id, c.name AS class_name, c.grade_level,
              SUM(b.net_due) AS due, SUM(b.paid) AS paid, SUM(b.balance) AS balance,
              SUM(GREATEST(b.balance, 0)) FILTER (WHERE b.due_date < CURRENT_DATE) AS overdue,
              array_agg(DISTINCT b.eth_month ORDER BY b.eth_month) FILTER (WHERE b.balance > 0 AND b.eth_month IS NOT NULL) AS months_open,
              COUNT(*) FILTER (WHERE b.balance > 0 AND b.eth_month IS NULL)::int AS other_open
       FROM student_charge_balances b JOIN students s ON s.id = b.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE ${filter}
       GROUP BY s.id, c.id HAVING SUM(b.balance) > 0
       ORDER BY c.grade_level NULLS LAST, c.name, s.first_name, s.last_name`, params);
    const classes = [];
    for (const s of students) {
      let c = classes.find((x) => x.class_id === s.class_id);
      if (!c) classes.push(c = { class_id: s.class_id, class_name: s.class_name, grade_level: s.grade_level, students: 0, due: 0, paid: 0, balance: 0, overdue: 0 });
      c.students++; c.due += toCents(s.due); c.paid += toCents(s.paid); c.balance += toCents(s.balance); c.overdue += toCents(s.overdue);
    }
    for (const c of classes) for (const k of ['due', 'paid', 'balance', 'overdue']) c[k] = fromCents(c[k]);
    const total = fromCents(students.reduce((a, s) => a + toCents(s.balance), 0));
    return sendSuccess(res, { year: { ...year, eth_year: F.ecYearOf(year) }, scope, eth_month: month, total, classes, students },
      `${students.length} student(s) owe ${total}.`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// GET /finance/student/:studentId?academic_year_id=
// overview: all years (as before); year: the chosen year (default the student's class year,
// else the current one) with its charges by month, one-time and legacy charges, discounts, payments.
const getStudentBalance = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { academic_year_id } = req.query;
    if (academic_year_id && !/^[0-9a-f-]{36}$/i.test(academic_year_id)) return sendError(res, 'Invalid id.', 400);
    const { rows: [student] } = await db.query(
      `SELECT s.id, s.student_number, s.first_name, s.last_name, s.first_name_am, s.fathers_name_am, s.last_name_am, s.status,
              c.id AS class_id, c.name AS class_name, c.grade_level, c.academic_year_id AS class_year_id
       FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [studentId]);
    const year = await getYear(db, academic_year_id || student.class_year_id);
    const charges = year ? (await db.query(
      `SELECT ${CHARGE_COLUMNS} FROM student_charge_balances b WHERE b.student_id = $1 AND b.academic_year_id = $2
       ORDER BY b.eth_month NULLS LAST, b.category, b.created_at`, [studentId, year.id])).rows : [];
    const discounts = year ? (await db.query(
      `SELECT d.*, f.category, f.frequency FROM student_discounts d JOIN fee_structures f ON f.id = d.fee_structure_id
       WHERE d.student_id = $1 AND f.academic_year_id = $2 ORDER BY f.category`, [studentId, year.id])).rows : [];
    const { rows: payments } = await db.query(
      `SELECT p.*, ay.name AS academic_year, CASE WHEN p.reversed_at IS NULL THEN 'valid' ELSE 'reversed' END AS status,
              (SELECT json_agg(json_build_object('charge_id', a.charge_id, 'amount', a.amount, 'category', c.category,
                       'eth_month', c.eth_month, 'legacy_term', c.legacy_term) ORDER BY c.eth_month NULLS LAST, c.category)
               FROM payment_allocations a JOIN student_charges c ON c.id = a.charge_id WHERE a.payment_id = p.id) AS lines
       FROM payments p LEFT JOIN academic_years ay ON ay.id = p.academic_year_id
       WHERE p.student_id = $1 ORDER BY p.payment_date DESC, p.created_at DESC`, [studentId]);
    const { rows: years } = await db.query(
      `SELECT b.academic_year_id, ay.name, ay.end_date, SUM(b.net_due) AS total_due, SUM(b.paid) AS total_paid, SUM(b.balance) AS balance
       FROM student_charge_balances b JOIN academic_years ay ON ay.id = b.academic_year_id
       WHERE b.student_id = $1 GROUP BY b.academic_year_id, ay.name, ay.end_date ORDER BY ay.end_date`, [studentId]);
    return sendSuccess(res, {
      student,
      overview: await F.studentTotals(db, studentId),
      years,
      year: year ? {
        ...year, eth_year: F.ecYearOf(year), overview: await F.studentTotals(db, studentId, year.id),
        months: charges.filter((c) => c.eth_month !== null),
        one_time: charges.filter((c) => c.eth_month === null && !c.legacy_term),
        legacy: charges.filter((c) => c.legacy_term),
        discounts,
      } : null,
      payments,
    }, 'Student balance retrieved.');
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

// GET /finance/unpaid — students owing now (all years), as the old finance page lists them
const getUnpaidStudents = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.first_name || ' ' || s.last_name AS name, s.student_number, c.name AS class_name,
              SUM(b.balance) AS balance
       FROM student_charge_balances b
       JOIN students s ON s.id = b.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE ${F.DUE_NOW}
       GROUP BY s.id, s.first_name, s.last_name, s.student_number, c.name
       HAVING SUM(b.balance) > 0
       ORDER BY balance DESC`);
    return sendSuccess(res, rows, `${rows.length} student(s) with outstanding balance.`);
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

module.exports = {
  listFeeStructures, createFeeStructure, updateFeeStructure, deleteFeeStructure, generateCharges,
  listCharges, createCharge, waiveCharge,
  listDiscounts, createDiscount, updateDiscount, deleteDiscount,
  recordPayment, getPayments, getPayment, reversePayment, loadReceipt,
  getFinanceSummary, getOutstanding, getStudentBalance, getUnpaidStudents,
  FinanceError,
};
