// Phase 1 Group D: finance outstanding, parent family fees, teacher dashboard.
// Scratch DB backend on :3100 (+ static frontend on :5500 for one browser check). Run via guard.sh.
const pool = require('./tdb');
const G = require('./g3.json');
const { launch, Browser } = require('./cdp');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const tag = String(Date.now()).slice(-6);

(async () => {
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const TA = await login(G.tA.email, 'Pass#2026'), TB = await login(G.tB.email, 'Pass#2026');
  const PA = await login(G.parent.email, 'Pass#2026');

  // ── 1. Finance outstanding: reproduce 23,600 expected / 22,600 collected ──
  console.log('== Finance summary outstanding');
  const origYear = (await call(A, 'GET', '/academic-years/current')).body.data;
  // A year name not used by an earlier run (names are unique; earlier runs leave theirs behind)
  let ny;
  for (let n = +tag.slice(-2) % 99, tries = 0; tries < 99; n = (n + 1) % 99, tries++) {
    const yName = `20${String(n).padStart(2, '0')}/20${String(n + 1).padStart(2, '0')}`;
    ny = await call(A, 'POST', '/academic-years', { name: yName, start_date: '2030-09-01', end_date: '2031-07-31' });
    if (ny.status !== 409) break;
  }
  await call(A, 'POST', `/academic-years/${ny.body.data.id}/activate`);
  try {
    const pay = (due, paid, sid) => call(A, 'POST', '/finance/payments', { student_id: sid, amount_due: due, amount_paid: paid, payment_method: 'cash', payment_date: '2026-10-08' });
    // 23,600 due / 22,600 paid across three payments: two paid in full, one with 1,000 left
    // plus a zero-paid charge (was rejected before the fix)
    const zero = await pay(0, 0, G.s1.sid);
    ok(zero.status === 201, 'payment row with amount 0 accepted', String(zero.status));
    await pay(10000, 10000, G.s1.sid); await pay(8600, 8600, G.s2.sid); await pay(5000, 4000, G.s3.sid);
    for (const [who, tok] of [['admin', A], ['principal', P]]) {
      const s = (await call(tok, 'GET', '/finance/summary')).body.data.summary;
      ok(+s.total_expected === 23600 && +s.total_collected === 22600, `${who}: expected 23,600 / collected 22,600`, `${s.total_expected} / ${s.total_collected}`);
      ok(+s.total_outstanding === 1000 && +s.outstanding === 1000, `${who}: outstanding 1,000 (total_outstanding and outstanding)`, `${s.total_outstanding}`);
    }
    const ov = (await call(A, 'GET', '/analytics/overview')).body.data.finance;
    // Decision 4: outstanding = sum of per-student debts; net = expected - collected; credit = overpayments
    ok(+ov.net_balance === +ov.total_expected - +ov.total_collected && +ov.total_outstanding - +ov.total_credit === +ov.net_balance && +ov.outstanding === +ov.total_outstanding,
      'analytics overview: outstanding - credit = net = expected - collected', `${ov.total_outstanding} - ${ov.total_credit} = ${ov.net_balance}`);

    // Browser: the existing finance page now shows 1,000
    const { close, wsUrl } = await launch(); const b = new Browser(wsUrl); await b.connect();
    try {
      const pg = await b.newPage();
      await pg.goto('http://localhost:5599/login.html', 800);
      await pg.waitFor(`typeof handleLogin === 'function'`, 15000);
      await pg.eval(`document.getElementById('email').value='admin@asms.et'; document.getElementById('password').value='Admin@1234'; handleLogin(); true`);
      await pg.waitFor(`location.pathname.endsWith('dashboard.html')`, 15000);
      await pg.goto('http://localhost:5599/finance.html', 2500);
      const shown = await pg.eval(`document.getElementById('totalOutstanding').textContent.trim()`);
      ok(shown === '1,000', 'finance.html shows Outstanding 1,000 (no frontend change)', shown);
    } finally { await close(); }
  } finally {
    await call(A, 'POST', `/academic-years/${origYear.id}/activate`);
    ok((await call(A, 'GET', '/academic-years/current')).body.data.id === origYear.id, 'original academic year re-activated');
  }

  // ── 2. Parent family fees ──
  console.log('== GET /parent/fees');
  const mkStudent = async (n) => (await call(A, 'POST', '/students', { first_name: 'Fee', last_name: n + tag, gender: 'male', class_id: G.c9A })).body.data;
  const k1 = await mkStudent('One'), k2 = await mkStudent('Two'), k3 = await mkStudent('Three');
  const par = (await call(A, 'POST', '/accounts/parents', { full_name: 'Fee Parent', phone: '0911', email: `fees${tag}@asms.et` })).body.data;
  for (const [k, rel] of [[k1, 'father'], [k2, 'father'], [k3, 'father']]) await call(A, 'POST', `/accounts/parents/${par.id}/children`, { student_id: k.id, relationship: rel });
  await call(A, 'POST', '/finance/payments', { student_id: k1.id, amount_due: 3500, amount_paid: 3500, payment_method: 'cash', payment_date: '2026-10-08' });
  await call(A, 'POST', '/finance/payments', { student_id: k2.id, amount_due: 3500, amount_paid: 1500, payment_method: 'telebirr', payment_date: '2026-10-08' });
  await call(A, 'POST', '/finance/payments', { student_id: k2.id, amount_due: 500, amount_paid: 0, category: 'material', payment_method: 'cash', payment_date: '2026-10-08' });
  const l = await call(null, 'POST', '/auth/login', { email: `fees${tag}@asms.et`, password: par.temporary_password });
  const PT = (await call(l.body.data.accessToken, 'POST', '/auth/change-password', { currentPassword: par.temporary_password, newPassword: 'Fees#2026' })).body.data.accessToken;
  const ff = await call(PT, 'GET', '/parent/fees');
  const by = Object.fromEntries(ff.body.data.children.map(c => [c.student_id, c]));
  ok(ff.status === 200 && ff.body.data.children.length === 3, 'three children listed');
  ok(by[k1.id].balance === 0 && by[k1.id].status === 'paid', 'child 1: paid, balance 0');
  ok(by[k2.id].total_due === 4000 && by[k2.id].total_paid === 1500 && by[k2.id].balance === 2500 && by[k2.id].status === 'partial', 'child 2: partial, balance 2,500 (two payments)');
  ok(by[k3.id].status === 'no_records' && by[k3.id].balance === 0, 'child 3: no payment records');
  const fam = ff.body.data.family;
  ok(fam.total_due === 7500 && fam.total_paid === 5000 && fam.balance === 2500, 'family totals 7,500 / 5,000 / 2,500', JSON.stringify(fam));
  const own = (await call(PA, 'GET', '/parent/fees')).body.data.children.map(c => c.student_id);
  ok(!own.includes(k1.id) && own.includes(G.s1.sid), "another parent sees only their own children");
  for (const [who, tok] of [['admin', A], ['principal', P], ['teacher', TA]]) ok((await call(tok, 'GET', '/parent/fees')).status === 403, `${who}: /parent/fees -> 403`);

  // ── 3. Teacher dashboard ──
  console.log('== GET /dashboard/teacher');
  // Same weekday the dashboard uses (Postgres CURRENT_DATE); Sunday is not a school day
  const todayName = (await pool.query("SELECT trim(to_char(CURRENT_DATE, 'Day')) d")).rows[0].d;
  const schoolDay = todayName !== 'Sunday';
  if (schoolDay) await call(A, 'POST', '/timetable', { class_id: G.c9A, subject_id: G.math, teacher_id: G.tA.tid, day: todayName, period: 8, start_time: '15:00', end_time: '16:00', room: 'R9' });
  await call(TA, 'POST', '/attendance', { class_id: G.c9A, date: (await pool.query("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') d")).rows[0].d, records: [{ student_id: G.s1.sid, status: 'absent' }] });
  const d = await call(TA, 'GET', '/dashboard/teacher');
  ok(d.status === 200, 'teacher A gets the dashboard');
  const D = d.body.data;
  ok(D.teacher.id === G.tA.tid, 'teacher identified');
  ok(D.classes.length === 1 && D.classes[0].class_id === G.c9A && D.classes[0].subjects.map(s => s.subject).join() === 'Mathematics', 'classes: 9A / Mathematics only');
  const act = (await pool.query("SELECT COUNT(*)::int n FROM students WHERE class_id=$1 AND status='active'", [G.c9A])).rows[0].n;
  ok(D.classes[0].student_count === act, 'student count matches active 9A students', `${D.classes[0].student_count}`);
  const at = D.attendance_today[0];
  ok(D.attendance_today.length === 1 && at.total === act && at.marked >= 1 && at.absent >= 1, "today's attendance for 9A (marked/absent counted)", JSON.stringify(at));
  ok(D.upcoming_exams.some(e => e.name === 'G7 9A quiz') && D.upcoming_exams.every(e => e.class_name === 'Grade 9 Section A'), 'upcoming exams: own class only');
  ok(D.grading_pending.length > 0 && D.grading_pending.every(g => g.class_name === 'Grade 9 Section A' && g.subject_name === 'Mathematics' && g.graded < g.students), 'grading pending: own class+subject, incomplete only');
  if (schoolDay) ok(D.timetable_today.some(s => s.period === 8 && s.room === 'R9'), `today's timetable slot shown (${todayName})`);
  else ok(D.timetable_today.length === 0, "Sunday: no timetable slots today");
  const keys = []; const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } }; walk(D);
  ok(!keys.some(k => /amount|balance|payment|fee|finance|due|paid/i.test(k)), 'no finance fields in the teacher dashboard', [...new Set(keys)].join(','));
  const db2 = (await call(TB, 'GET', '/dashboard/teacher')).body.data;
  ok(db2.classes.length === 0 && db2.attendance_today.length === 0 && db2.upcoming_exams.length === 0 && db2.grading_pending.length === 0, 'teacher B (no assignments): everything empty');
  for (const [who, tok] of [['admin', A], ['principal', P], ['parent', PA]]) ok((await call(tok, 'GET', '/dashboard/teacher')).status === 403, `${who}: /dashboard/teacher -> 403`);

  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
