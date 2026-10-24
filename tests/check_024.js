// Dry run and before/after check for migration 024 (monthly fees, M8) on asms_restore_check
// (also asms_phase0_test). Usage (through tests/restore_check.sh):
//   node tests/check_024.js before   payments per year, term and category, totals per student and year,
//                                    outstanding/credit (PERMISSIONS decision 4), receipt numbers,
//                                    fee_structures rows to move; checksums
//   node tests/check_024.js after    one legacy charge + allocation per payment, totals per student
//                                    and year unchanged, receipts and payments unchanged,
//                                    fee_structures_legacy = the old rows, fee_structures empty
// Read-only. Refuses any other database.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const DB = process.env.DB_NAME;
if (!['asms_restore_check', 'asms_phase0_test'].includes(DB)) { console.error('[check_024] ABORT: DB_NAME is', DB); process.exit(1); }
const phase = process.argv[2];
const SAVED = path.join(require('os').tmpdir(), `asms_check_024_${DB}.json`);
// Payment columns that 024 keeps as they are
const PAY = 'x.id, x.student_id, x.academic_year_id, x.term, x.category, x.amount_due, x.amount_paid, x.payment_method, x.payment_date, x.receipt_number, x.reference, x.recorded_by, x.notes, x.created_at';
const FEE = 'x.id, x.academic_year_id, x.grade_level, x.term, x.category, x.amount, x.description, x.due_date, x.created_at';
const money = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 });

(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB });
  await c.connect();
  if ((await c.query('SELECT current_database() d')).rows[0].d !== DB) process.exit(1);
  await c.query('SET default_transaction_read_only = on');
  let bad = 0;
  const sum = async (q) => (await c.query(`SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5(ROW(${q.cols})::text), '' ORDER BY x.id)), '-') AS sum FROM ${q.from} x`)).rows[0];
  const applied = (await c.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'student_charges'")).rows.length > 0;

  if (phase === 'before') {
    if (applied) { console.error('  024 already applied here'); process.exit(1); }
    const byGroup = (await c.query(
      `SELECT ay.name AS year, p.term, p.category, COUNT(*)::int n, SUM(amount_due) due, SUM(amount_paid) paid
       FROM payments p JOIN academic_years ay ON ay.id = p.academic_year_id GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)).rows;
    console.log('  payments by year, term and category (each becomes a legacy charge + payment + allocation):');
    for (const r of byGroup) console.log(`    ${r.year} ${r.term} ${r.category.padEnd(12)} ${String(r.n).padStart(4)}  due ${money(r.due).padStart(12)}  paid ${money(r.paid).padStart(12)}`);
    const per = (await c.query(
      `SELECT student_id, academic_year_id, COUNT(*)::int n, SUM(amount_due)::text due, SUM(amount_paid)::text paid
       FROM payments GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
    const tot = (await c.query(
      `WITH ps AS (SELECT student_id, SUM(amount_due) due, SUM(amount_paid) paid FROM payments GROUP BY 1)
       SELECT COUNT(*)::int students, COALESCE(SUM(due), 0)::text due, COALESCE(SUM(paid), 0)::text paid,
              COALESCE(SUM(GREATEST(due - paid, 0)), 0)::text outstanding, COALESCE(SUM(GREATEST(paid - due, 0)), 0)::text credit FROM ps`)).rows[0];
    console.log(`  totals: ${tot.students} student(s), ${per.length} student/year pair(s); due ${money(tot.due)}, paid ${money(tot.paid)}, outstanding ${money(tot.outstanding)}, credit ${money(tot.credit)}`);
    const odd = (await c.query(
      `SELECT COUNT(*) FILTER (WHERE amount_paid > amount_due)::int above, COUNT(*) FILTER (WHERE amount_paid = 0)::int zero,
              COUNT(*) FILTER (WHERE receipt_number IS NULL)::int no_receipt, COUNT(*) FILTER (WHERE fee_structure_id IS NOT NULL)::int with_fs FROM payments`)).rows[0];
    console.log(`  payments paid above due: ${odd.above}; paid 0 (charge only, no allocation): ${odd.zero}; without receipt: ${odd.no_receipt}; referring to a fee structure: ${odd.with_fs} (024 stops if > 0)`);
    const fs0 = (await c.query('SELECT COUNT(*)::int n, COUNT(DISTINCT academic_year_id)::int years FROM fee_structures')).rows[0];
    console.log(`  fee_structures: ${fs0.n} per-term row(s) in ${fs0.years} year(s) -> fee_structures_legacy`);
    fs.writeFileSync(SAVED, JSON.stringify({
      per, tot, payments: await sum({ cols: PAY, from: 'payments' }), fees: await sum({ cols: FEE, from: 'fee_structures' }),
    }));
  } else if (phase === 'after') {
    if (!applied) { console.error('  024 not applied here'); process.exit(1); }
    const saved = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    const ok = (label, good, detail = '') => { if (!good) bad++; console.log(`  ${label.padEnd(52)} ${good ? 'ok' : 'WRONG'}${detail ? `  ${detail}` : ''}`); };
    const p = await sum({ cols: PAY, from: 'payments' });
    ok('payments unchanged (receipts, dates, methods)', p.n === saved.payments.n && p.sum === saved.payments.sum, `${saved.payments.n} -> ${p.n}`);
    const f = await sum({ cols: FEE, from: 'fee_structures_legacy' });
    ok('fee_structures_legacy = the old rows', f.n === saved.fees.n && f.sum === saved.fees.sum, `${saved.fees.n} -> ${f.n}`);
    const fsNow = (await c.query('SELECT COUNT(*)::int n FROM fee_structures')).rows[0].n;
    ok('fee_structures empty (re-enter as monthly/one-time)', fsNow === 0, `${fsNow}`);
    const amt = (await c.query('SELECT COUNT(*) FILTER (WHERE amount <> amount_paid)::int d FROM payments')).rows[0].d;
    ok('payments.amount = amount_paid', amt === 0);
    const ch = (await c.query(
      `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE legacy_term IS NOT NULL AND eth_month IS NULL AND fee_structure_id IS NULL)::int legacy,
              (SELECT COUNT(*)::int FROM payment_allocations) alloc,
              (SELECT COUNT(*)::int FROM payments WHERE amount_paid > 0) paying FROM student_charges`)).rows[0];
    ok('one legacy charge per payment (no month)', ch.n === p.n && ch.legacy === ch.n, `${ch.legacy} of ${ch.n}`);
    ok('one allocation per payment paid > 0', ch.alloc === ch.paying, `${ch.alloc}`);
    const per = (await c.query(
      `SELECT student_id, academic_year_id, COUNT(*)::int n, SUM(net_due)::text due, SUM(paid)::text paid
       FROM student_charge_balances GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
    const key = (r) => `${r.student_id}|${r.academic_year_id}|${r.n}|${Number(r.due).toFixed(2)}|${Number(r.paid).toFixed(2)}`;
    const diff = saved.per.filter((r, i) => !per[i] || key(r) !== key(per[i])).length + Math.max(0, per.length - saved.per.length);
    ok('totals per student and year unchanged', diff === 0, `${saved.per.length} pair(s), ${diff} different`);
    const tot = (await c.query(
      `WITH ps AS (SELECT student_id, SUM(net_due) due, SUM(paid) paid FROM student_charge_balances GROUP BY 1)
       SELECT COUNT(*)::int students, COALESCE(SUM(due), 0)::text due, COALESCE(SUM(paid), 0)::text paid,
              COALESCE(SUM(GREATEST(due - paid, 0)), 0)::text outstanding, COALESCE(SUM(GREATEST(paid - due, 0)), 0)::text credit FROM ps`)).rows[0];
    for (const k of ['due', 'paid', 'outstanding', 'credit']) {
      ok(`total ${k}`, Number(tot[k]).toFixed(2) === Number(saved.tot[k]).toFixed(2), `${money(saved.tot[k])} -> ${money(tot[k])}`);
    }
    const st = (await c.query('SELECT status, COUNT(*)::int n FROM student_charge_balances GROUP BY 1 ORDER BY 1')).rows;
    console.log(`  legacy charges by status: ${st.map((s) => `${s.status} ${s.n}`).join(', ') || '-'}`);
    const rc = (await c.query('SELECT COUNT(*)::int n FROM receipt_counters')).rows[0].n;
    ok('receipt_counters empty (new numbers start at 00001)', rc === 0);
    console.log(bad ? `[check_024] ${bad} problem(s)` : '[check_024] OK');
  } else {
    console.error('usage: node tests/check_024.js before|after'); process.exit(1);
  }
  await c.end();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
