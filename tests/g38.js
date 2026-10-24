// Phase 2 M10: switch-over. Migration 026 (old columns and fee_structures_legacy gone, the
// semester trigger takes the date only), the removed endpoints and shapes (POST /grades/exams,
// GET /finance/unpaid, the term payment shape, ?term=), and the school-wide payment history
// (GET /finance/payments: filters for dates, method, receipt number, student and status; totals
// per day and per method for the cash-up, reversed receipts apart; roles). A year that contains
// today is made current while it runs (todayyear.js), 2024/2025 put back afterwards.
// Scratch DB backend on :3100.
const pool = require('./tdb');
const { useTodayYear, restoreFixtureYear, addDays } = require('./todayyear');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const msg = (r) => `${r.status} ${r.body?.message ?? ''}`;
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const GRADE = 4;   // this suite's class: grade 4 of the today year
const cents = (v) => Math.round(Number(v ?? 0) * 100);
const col = async (t, c) => (await pool.query('SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [t, c])).rows.length > 0;

(async () => {
  const A = await login('admin@asms.et', 'Admin@1234');
  const TA = await login(G.tA.email, 'Pass#2026');
  await pool.query("INSERT INTO users (email, password_hash, role) SELECT 'g38p@asms.et', password_hash, 'principal' FROM users WHERE email = 'admin@asms.et' ON CONFLICT (email) DO NOTHING");
  const P = await login('g38p@asms.et', 'Admin@1234');

  console.log('== Migration 026');
  for (const [t, c] of [['exams', 'term'], ['grades', 'grade_letter'], ['payments', 'term'], ['payments', 'category'], ['payments', 'amount_due'], ['payments', 'amount_paid']]) {
    ok(!(await col(t, c)), `${t}.${c} dropped`);
  }
  ok(!(await pool.query("SELECT to_regclass('fee_structures_legacy') r")).rows[0].r, 'fee_structures_legacy dropped');
  ok(!(await pool.query("SELECT 1 FROM pg_proc WHERE proname = 'asms_semester_for'")).rows.length, 'asms_semester_for (term fallback) dropped');
  ok(await col('student_charges', 'legacy_term'), 'student_charges.legacy_term kept (old term charges)');

  console.log('== Removed endpoints and shapes');
  ok((await call(A, 'POST', '/grades/exams', { class_id: G.c9A, subject_id: G.math, name: 'x', exam_type: 'quiz', semester: 1 })).status === 404, 'POST /grades/exams -> 404');
  ok((await call(A, 'GET', '/grades/exams')).status === 200, 'GET /grades/exams still there');
  ok((await call(A, 'GET', '/finance/unpaid')).status === 404, 'GET /finance/unpaid -> 404');
  let r = await call(A, 'POST', '/finance/payments', { student_id: G.s1.sid, amount_due: 10, amount_paid: 10, payment_method: 'cash', payment_date: '2025-01-10' });
  ok(r.status === 400 && r.body?.errors?.field === 'allocations', 'term payment shape -> 400 (send allocations)', msg(r));
  r = await call(A, 'POST', '/exam-schedule', { class_id: G.c9A, subject_id: G.math, name: `G38 ${tag}`, exam_type: 'quiz', max_score: 1, exam_date: '2024-11-15', term: 'term1' });
  ok(r.status === 400 && r.body?.errors?.field === 'term', 'term on /exam-schedule -> 400', msg(r));
  ok((await call(A, 'GET', `/exam-schedule/class/${G.c9A}?term=term1`)).status === 400, '?term= on the exam list -> 400');
  ok((await call(A, 'GET', `/grades/report-card/${G.s1.sid}?term=term1`)).status === 400, '?term= on the report card -> 400');
  ok((await call(A, 'GET', '/finance/payments?term=term1')).status === 400, '?term= on the payment history -> 400');
  r = await call(A, 'GET', `/grades/report-card/${G.s1.sid}?semester=1`);
  ok(r.status === 200 && !('gpa' in r.body.data.academic_summary) && !JSON.stringify(r.body.data).includes('grade_letter'), 'report card: no gpa or grade_letter placeholders');

  let cls = null; const students = [];
  try {
    const { year, today } = await useTodayYear(call, A);
    const yday = addDays(today, -1) >= year.start_date ? addDays(today, -1) : today;
    console.log(`  (current year ${year.name}, today ${today}, other day ${yday})`);
    const used = new Set((await pool.query('SELECT section FROM classes WHERE academic_year_id = $1 AND grade_level = $2', [year.id, GRADE])).rows.map((x) => x.section));
    const section = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').find((s) => !used.has(s));
    cls = (await call(A, 'POST', '/classes', { academic_year_id: year.id, grade_level: GRADE, section })).body.data.id;
    for (const n of ['Abel', 'Beti']) students.push((await call(A, 'POST', '/students', { first_name: n, last_name: `G38${tag}`, gender: 'male', class_id: cls })).body.data.id);
    const [s1, s2] = students;
    const charge = async (sid, amount) => (await call(A, 'POST', '/finance/charges', { student_id: sid, category: 'material', amount, description: `G38 ${tag}` })).body.data.id;
    const pay = async (sid, amount, method, date, more = {}) => {
      const x = await call(A, 'POST', '/finance/payments', { student_id: sid, allocations: [{ charge_id: await charge(sid, amount), amount }], payment_method: method, payment_date: date, ...(method === 'cash' ? {} : { reference: `REF-${tag}-${Math.random().toString(36).slice(2, 7)}` }), ...more });
      if (x.status !== 201) throw new Error(`pay: ${msg(x)}`);
      return x.body.data;
    };
    const hist = async (q, tok = A) => call(tok, 'GET', `/finance/payments?${q}`);
    const dayOf = (d, date) => d.by_day.find((x) => x.date === date);
    const before = (await hist(`from=${today}&to=${today}`)).body.data;

    // s1: cash 100 today, telebirr 250 today, cash 40 the other day; s2: cash 60 today, mpesa 30 today (reversed)
    const p1 = await pay(s1, 100, 'cash', today);
    await pay(s1, 250, 'telebirr', today);
    await pay(s1, 40, 'cash', yday);
    await pay(s2, 60, 'cash', today);
    const pr = await pay(s2, 30, 'mpesa', today);
    ok((await call(A, 'POST', `/finance/payments/${pr.id}/reverse`, { reason: 'Wrong student' })).status === 200, 'one receipt reversed (M-Pesa 30)');

    console.log('== Payment history: one student');
    r = await hist(`student_id=${s1}`);
    let d = r.body?.data;
    ok(r.status === 200 && d.payments.length === 3 && d.pagination.total === 3, 's1: 3 receipts', msg(r));
    ok(d.payments.every((p, i, a) => i === 0 || a[i - 1].payment_date >= p.payment_date), 'newest first');
    const row = d.payments.find((p) => p.id === p1.id);
    ok(row && row.student_name === `Abel G38${tag}` && row.class_name && row.status === 'valid' && row.recorded_by_name && row.lines?.[0]?.category === 'material' && cents(row.lines[0].amount) === 10000,
      'a row: student, class, status, recorded by, lines with category and amount', JSON.stringify(row?.lines));
    ok(!('term' in row) && !('amount_due' in row) && !('amount_paid' in row) && !('category' in row), 'no old payment columns in the rows');
    ok(cents(d.totals.amount) === 39000 && d.totals.count === 3 && d.totals.reversed_count === 0, 's1 totals: 3 receipts, 390.00');
    const bm = Object.fromEntries(d.by_method.map((m) => [m.method, m]));
    ok(cents(bm.cash?.amount) === 14000 && bm.cash.count === 2 && cents(bm.telebirr?.amount) === 25000, 's1 by method: cash 140 (2), telebirr 250');

    console.log('== Cash-up: one day, all students');
    d = (await hist(`from=${today}&to=${today}`)).body.data;
    const b = dayOf(before, today), a = dayOf(d, today);
    const delta = (m) => cents(a?.methods?.[m]?.amount) - cents(b?.methods?.[m]?.amount);
    ok(cents(a.amount) - cents(b?.amount) === 41000 && a.count - (b?.count ?? 0) === 3, 'today: +410.00 in 3 valid receipts (the reversed one left out)');
    ok(delta('cash') === 16000 && delta('telebirr') === 25000 && delta('mpesa') === 0, 'today per method: cash +160, telebirr +250, M-Pesa +0 (reversed)');
    ok(d.by_day.every((x) => x.date === today), 'a one-day range gives one day');
    ok(d.totals.reversed_count - before.totals.reversed_count === 1 && cents(d.totals.reversed_amount) - cents(before.totals.reversed_amount) === 3000, 'reversed receipts counted apart: +1, 30.00');
    ok(d.totals.receipts === d.totals.count + d.totals.reversed_count, 'receipts = valid + reversed');
    d = (await hist(`from=${today}&to=${today}&method=cash&student_id=${s2}`)).body.data;
    ok(d.payments.length === 1 && cents(d.totals.amount) === 6000, 'method + student + day: s2 cash today 60.00');
    d = (await hist(`student_id=${s1}&from=${yday}&to=${yday}`)).body.data;
    ok(yday === today || (d.payments.length === 1 && cents(d.totals.amount) === 4000), 'the other day alone: 40.00');

    console.log('== Status and receipt number');
    d = (await hist(`student_id=${s2}&status=reversed`)).body.data;
    ok(d.payments.length === 1 && d.payments[0].id === pr.id && d.payments[0].reversal_reason === 'Wrong student' && cents(d.totals.amount) === 0 && d.by_day.length === 0, 'status=reversed: the reversed receipt, no valid totals');
    d = (await hist(`student_id=${s2}&status=valid`)).body.data;
    ok(d.payments.length === 1 && d.payments[0].status === 'valid', 'status=valid');
    d = (await hist(`receipt=${encodeURIComponent(p1.receipt_number.slice(-5))}&student_id=${s1}`)).body.data;
    ok(d.payments.length === 1 && d.payments[0].receipt_number === p1.receipt_number, `receipt search by part of the number (${p1.receipt_number.slice(-5)})`);
    d = (await hist(`receipt=${encodeURIComponent(p1.receipt_number.toLowerCase())}`)).body.data;
    ok(d.payments.length === 1, 'receipt search ignores case');
    d = (await hist(`receipt=%25&student_id=${s1}`)).body.data;
    ok(d.payments.length === 0, '"%" is a literal, not a wildcard');

    console.log('== Bad input and roles');
    for (const [q, label] of [[`from=${today}&to=${yday === today ? addDays(today, -1) : yday}`, 'to before from'], ['from=2025-13-01', 'bad from'], ['method=cheque', 'unknown method'], ['status=void', 'unknown status'], ['student_id=x', 'malformed student_id'], ['limit=201', 'limit above 200']]) {
      ok((await hist(q)).status === 400, `${label} -> 400`);
    }
    ok((await hist('limit=1')).body.data.payments.length === 1, 'limit=1 -> 1 row (totals still over the whole filter)');
    ok((await hist(`student_id=${s1}`, P)).status === 200, 'principal reads the history');
    ok((await hist('', TA)).status === 403, 'teacher -> 403');
  } finally {
    if (students.length) {
      await pool.query('DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE student_id = ANY($1::uuid[]))', [students]);
      await pool.query('DELETE FROM payments WHERE student_id = ANY($1::uuid[])', [students]);
      await pool.query('DELETE FROM student_charges WHERE student_id = ANY($1::uuid[])', [students]);
      for (const s of students) await call(A, 'DELETE', `/students/${s}`);
    }
    if (cls) await call(A, 'DELETE', `/classes/${cls}`);
    await restoreFixtureYear(call, A);
    ok((await call(A, 'GET', '/academic-years/current')).body.data.name === '2024/2025', '2024/2025 is current again');
  }

  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
