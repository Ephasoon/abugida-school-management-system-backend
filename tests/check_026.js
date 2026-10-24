// Dry run and before/after check for migration 026 (M10 cleanup) on asms_restore_check
// (also asms_phase0_test). Usage (through tests/restore_check.sh):
//   node tests/check_026.js before   what 026 removes (exams with a term, grades with a letter,
//                                    payments with the old columns and whether each matches its
//                                    charge, amount_paid = amount, fee_structures_legacy rows);
//                                    checksums of every kept column of exams, grades, payments,
//                                    payment_allocations and student_charges; money totals
//   node tests/check_026.js after    the same rows and checksums, the same totals, each legacy
//                                    charge still holds its term and category, the columns and
//                                    the table are gone, the semester trigger is in place
// Read-only. Refuses any other database.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const DB = process.env.DB_NAME;
if (!['asms_restore_check', 'asms_phase0_test'].includes(DB)) { console.error('[check_026] ABORT: DB_NAME is', DB); process.exit(1); }
const phase = process.argv[2];
const SAVED = path.join(require('os').tmpdir(), `asms_check_026_${DB}.json`);

// The columns that stay (the same list before and after)
const KEEP = {
  exams: 'x.id, x.class_id, x.subject_id, x.academic_year_id, x.name, x.exam_type, x.semester, x.max_score, x.exam_date, x.created_by',
  grades: 'x.id, x.exam_id, x.student_id, x.score, x.remarks',
  payments: 'x.id, x.student_id, x.academic_year_id, x.amount, x.payment_method, x.payment_date, x.receipt_number, x.reference, x.recorded_by, x.notes, x.reversed_at, x.reversal_reason',
  payment_allocations: 'x.payment_id, x.charge_id, x.amount',
  student_charges: 'x.id, x.student_id, x.academic_year_id, x.category, x.eth_month, x.amount_due, x.discount_amount, x.legacy_term, x.waived_at',
};
const ORDER = { payment_allocations: 'x.payment_id, x.charge_id' };

(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB });
  await c.connect();
  if ((await c.query('SELECT current_database() d')).rows[0].d !== DB) process.exit(1);
  await c.query('SET default_transaction_read_only = on');
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  let bad = 0;
  const check = (ok, label, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`); if (!ok) bad++; };
  const sums = async () => {
    const out = {};
    for (const [t, cols] of Object.entries(KEEP)) {
      out[t] = (await q(`SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5(ROW(${cols})::text), '' ORDER BY ${ORDER[t] ?? 'x.id'})), '-') AS sum FROM ${t} x`))[0];
    }
    return out;
  };
  const totals = async () => (await q(`SELECT
      (SELECT COALESCE(SUM(amount), 0)::text FROM payments WHERE reversed_at IS NULL) AS collected,
      (SELECT COALESCE(SUM(amount), 0)::text FROM payment_allocations) AS allocated,
      (SELECT COALESCE(SUM(balance), 0)::text FROM student_charge_balances) AS balance,
      (SELECT COUNT(*)::int FROM exams WHERE semester = 'semester1') AS sem1,
      (SELECT COUNT(*)::int FROM exams WHERE semester = 'semester2') AS sem2`))[0];
  const column = async (t, col) => (await q('SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [t, col])).length > 0;

  if (phase === 'before') {
    console.log('  dry run, what 026 removes:');
    const ex = (await q(`SELECT COUNT(*)::int n, COUNT(term)::int with_term,
      COUNT(*) FILTER (WHERE term IS NOT NULL AND NOT ((term = 'term1' AND semester = 'semester1') OR (term IN ('term2', 'term3') AND semester = 'semester2')))::int disagree
      FROM exams`))[0];
    console.log(`    exams.term: ${ex.with_term} of ${ex.n} exams (${ex.disagree} where term and semester disagree: the semester stays)`);
    const gr = (await q('SELECT COUNT(*)::int n, COUNT(grade_letter)::int letters FROM grades'))[0];
    console.log(`    grades.grade_letter: ${gr.letters} of ${gr.n} grades have a letter`);
    const pay = (await q(`
      WITH p AS (SELECT * FROM payments WHERE term IS NOT NULL OR category IS NOT NULL OR amount_due IS NOT NULL)
      SELECT (SELECT COUNT(*)::int FROM payments) total, COUNT(*)::int old,
        COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM payment_allocations a WHERE a.payment_id = p.id) = 1
          AND EXISTS (SELECT 1 FROM payment_allocations a JOIN student_charges ch ON ch.id = a.charge_id
            WHERE a.payment_id = p.id AND ch.legacy_term IS NOT DISTINCT FROM p.term AND ch.category::text IS NOT DISTINCT FROM p.category::text
              AND ch.amount_due IS NOT DISTINCT FROM p.amount_due))::int matching,
        (SELECT COUNT(*)::int FROM payments WHERE amount_paid IS DISTINCT FROM amount) amount_differs
      FROM p`))[0];
    console.log(`    payments.term/category/amount_due: ${pay.old} of ${pay.total} payments; ${pay.matching} match their charge exactly`);
    check(pay.matching === pay.old, 'every old-shape payment matches its charge (026 would stop)');
    check(pay.amount_differs === 0, 'amount_paid = amount on every payment (026 would stop)', `${pay.amount_differs} differ`);
    const legacy = (await q("SELECT to_regclass('public.fee_structures_legacy') t"))[0].t
      ? (await q('SELECT COUNT(*)::int n FROM fee_structures_legacy'))[0].n : 'none';
    console.log(`    fee_structures_legacy: ${legacy} rows`);
    const lc = (await q(`SELECT COUNT(*)::int n, string_agg(legacy_term || ' ' || category, ', ' ORDER BY legacy_term, category) list
      FROM (SELECT DISTINCT legacy_term::text, category::text FROM student_charges WHERE legacy_term IS NOT NULL) x`))[0];
    const legacyCharges = (await q('SELECT COUNT(*)::int n FROM student_charges WHERE legacy_term IS NOT NULL'))[0].n;
    console.log(`    legacy charges (kept): ${legacyCharges}; term and category pairs: ${lc.list ?? 'none'}`);
    const s = await sums(); const t = await totals();
    console.log('  rows:', Object.entries(s).map(([k, v]) => `${k} ${v.n}`).join(', '));
    console.log(`  collected ${t.collected}, allocated ${t.allocated}, open balance ${t.balance}; exams semester 1: ${t.sem1}, semester 2: ${t.sem2}`);
    fs.writeFileSync(SAVED, JSON.stringify({ sums: s, totals: t, legacyCharges,
      legacyPairs: await q("SELECT x.id, x.legacy_term::text, x.category::text FROM student_charges x WHERE legacy_term IS NOT NULL ORDER BY id") }));
  } else if (phase === 'after') {
    const was = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    const s = await sums(); const t = await totals();
    for (const k of Object.keys(KEEP)) check(s[k].n === was.sums[k].n && s[k].sum === was.sums[k].sum, `${k}: ${was.sums[k].n} -> ${s[k].n} rows, kept columns unchanged (checksum)`);
    check(JSON.stringify(t) === JSON.stringify(was.totals), `collected ${t.collected}, allocated ${t.allocated}, balance ${t.balance}, semesters ${t.sem1}/${t.sem2} unchanged`);
    const pairs = await q("SELECT x.id, x.legacy_term::text, x.category::text FROM student_charges x WHERE legacy_term IS NOT NULL ORDER BY id");
    check(JSON.stringify(pairs) === JSON.stringify(was.legacyPairs), `the ${was.legacyCharges} legacy charges keep their term and category`);
    for (const [tb, col] of [['exams', 'term'], ['grades', 'grade_letter'], ['payments', 'term'], ['payments', 'category'], ['payments', 'amount_due'], ['payments', 'amount_paid']]) {
      check(!(await column(tb, col)), `${tb}.${col} gone`);
    }
    check(!(await q("SELECT to_regclass('public.fee_structures_legacy') t"))[0].t, 'fee_structures_legacy gone');
    check((await q("SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exams_semester'")).length === 1, 'semester trigger in place (date only)');
    check((await q("SELECT 1 FROM pg_proc WHERE proname = 'asms_semester_for'")).length === 0, 'asms_semester_for (term fallback) gone');
  } else { console.error('usage: before|after'); process.exit(1); }
  await c.end();
  console.log(bad ? `[check_026] ${bad} FAIL` : '[check_026] OK');
  process.exit(bad ? 1 : 0);
})();
