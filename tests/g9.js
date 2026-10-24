// Phase 1 Group D: finance outstanding, parent family fees, teacher dashboard.
// The dashboard part runs in a year containing today (tests/todayyear.js), 2024/2025 put back after.
// Scratch DB backend on :3100. Run via guard.sh.
const pool = require('./tdb');
const G = require('./g3.json');
const { createFreeYear } = require('./years');
const { FIXTURE_YEAR, useTodayYear, restoreFixtureYear } = require('./todayyear');
const { legacyPayment } = require('./fees');
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
  // A year with a name earlier runs have not used (names are unique and match the start year)
  const ny = await createFreeYear(call, A, 3000, 4000);
  await call(A, 'POST', `/academic-years/${ny.body.data.id}/activate`);
  try {
    const pay = (due, paid, sid) => legacyPayment(pool, { student_id: sid, academic_year_id: ny.body.data.id, due, paid });
    // 23,600 due / 22,600 paid across three payments: two paid in full, one with 1,000 left
    // plus a charge of 0 with nothing paid
    await pay(0, 0, G.s1.sid);
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
  const cy = (await pool.query('SELECT id FROM academic_years WHERE is_current')).rows[0].id;
  await legacyPayment(pool, { student_id: k1.id, academic_year_id: cy, due: 3500, paid: 3500 });
  await legacyPayment(pool, { student_id: k2.id, academic_year_id: cy, due: 3500, paid: 1500 });
  await legacyPayment(pool, { student_id: k2.id, academic_year_id: cy, due: 500, paid: 0, category: 'material' });
  const l = await call(null, 'POST', '/auth/login', { email: `fees${tag}@asms.et`, password: par.temporary_password });
  const PT = (await call(l.body.data.accessToken, 'POST', '/auth/change-password', { currentPassword: par.temporary_password, newPassword: 'Fees#2026' })).body.data.accessToken;
  const ff = await call(PT, 'GET', '/parent/fees');
  const by = Object.fromEntries(ff.body.data.children.map(c => [c.student_id, c]));
  ok(ff.status === 200 && ff.body.data.children.length === 3, 'three children listed');
  // Exact amounts as strings since M8 ("2500.00")
  ok(by[k1.id].balance === '0.00' && by[k1.id].status === 'paid', 'child 1: paid, balance 0');
  ok(by[k2.id].total_due === '4000.00' && by[k2.id].total_paid === '1500.00' && by[k2.id].balance === '2500.00' && by[k2.id].status === 'partial', 'child 2: partial, balance 2,500 (two payments)');
  ok(by[k3.id].status === 'no_records' && by[k3.id].balance === '0.00', 'child 3: no payment records');
  const fam = ff.body.data.family;
  ok(fam.total_due === '7500.00' && fam.total_paid === '5000.00' && fam.balance === '2500.00', 'family totals 7,500 / 5,000 / 2,500', JSON.stringify(fam));
  const own = (await call(PA, 'GET', '/parent/fees')).body.data.children.map(c => c.student_id);
  ok(!own.includes(k1.id) && own.includes(G.s1.sid), "another parent sees only their own children");
  for (const [who, tok] of [['admin', A], ['principal', P], ['teacher', TA]]) ok((await call(tok, 'GET', '/parent/fees')).status === 403, `${who}: /parent/fees -> 403`);

  // ── 3. Teacher dashboard ──
  // The dashboard lists this year's classes, and attendance can only be marked inside the
  // class's year (M4), but the fixtures' year 2024/2025 is in the past: a year containing
  // today is made current while this runs and 2024/2025 is put back (tests/todayyear.js).
  // g9's own class there, reused by every run: 9E with teacher A for Mathematics; earlier
  // runs' students, attendance and exams are cleared first, and again at the end with the
  // assignment and timetable slot, so other suites see teacher A in 9A only.
  console.log('== GET /dashboard/teacher');
  let cls = null;
  const clear = async () => {
    await pool.query("DELETE FROM attendance WHERE student_id IN (SELECT id FROM students WHERE last_name LIKE 'G9Dash%')");
    await pool.query("UPDATE students SET class_id = NULL WHERE last_name LIKE 'G9Dash%'");
    if (!cls) return;
    const old = (await pool.query('SELECT id FROM exams WHERE class_id = $1', [cls])).rows.map((r) => r.id);
    await pool.query('DELETE FROM grades WHERE exam_id = ANY($1::uuid[])', [old]);
    await pool.query('DELETE FROM exams WHERE id = ANY($1::uuid[])', [old]);
  };
  try {
    const { year, today } = await useTodayYear(call, A);
    console.log(`  (current year for this run: ${year.name}, today ${today})`);
    const list = (await call(A, 'GET', `/classes?academic_year_id=${year.id}`)).body.data;
    cls = list.find((c) => c.grade_level === 9 && c.section === 'E')?.id
      ?? (await call(A, 'POST', '/classes', { academic_year_id: year.id, grade_level: 9, section: 'E' })).body.data.id;
    await clear();
    await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: cls, subject_id: G.math });
    const stu = async (first) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G9Dash${tag}`, gender: 'female', class_id: cls })).body.data.id;
    const sa = await stu('Abeba'), sb = await stu('Bethel');

    // Same date and weekday the dashboard uses (Postgres CURRENT_DATE); Sunday is not a school day
    const { d: pgToday, dow: todayName } = (await pool.query("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') d, trim(to_char(CURRENT_DATE, 'Day')) dow")).rows[0];
    const schoolDay = todayName !== 'Sunday';
    // Today's slots: 9E (this year) at period 7, 9A (2024/2025) at period 8 (kept by earlier runs)
    if (schoolDay) {
      await call(A, 'POST', '/timetable', { class_id: G.c9A, subject_id: G.math, teacher_id: G.tA.tid, day: todayName, period: 8, start_time: '15:00', end_time: '16:00', room: 'R9' });
      const slot = await call(A, 'POST', '/timetable', { class_id: cls, subject_id: G.math, teacher_id: G.tA.tid, day: todayName, period: 7, start_time: '14:00', end_time: '15:00', room: 'R9E' });
      ok(slot.status === 201, `9E slot today (${todayName}, period 7) created`, String(slot.status));
    }
    const marked = await call(TA, 'POST', '/attendance', { class_id: cls, date: pgToday, records: [{ student_id: sa, status: 'absent' }] });
    ok(marked.status === 201, "teacher A marks today's attendance in own class of the current year", String(marked.status));
    const exam = async (name, date) => (await call(A, 'POST', '/exam-schedule', { class_id: cls, subject_id: G.math, name: `${name} ${tag}`, exam_type: 'quiz', max_score: 10, exam_date: date })).body.data?.id;
    const inDays = (n) => { const x = new Date(`${pgToday}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const soon = await exam('G9 upcoming', inDays(3));
    const held = await exam('G9 held', pgToday);
    await call(A, 'POST', '/grades', { exam_id: held, grades: [{ student_id: sa, score: 7 }] });
    ok(!!soon && !!held, 'exams created in the class (one in 3 days, one today)');
    // 9A of 2024/2025 (teacher A, Mathematics): an undated exam with a score missing, and one
    // dated in 3 days (raw inserts: the API needs a date inside the class's year since M10)
    const pastHeld = (await pool.query(
      `INSERT INTO exams (class_id, subject_id, academic_year_id, name, exam_type, max_score, semester)
       SELECT id, $2, academic_year_id, $3, 'quiz', 1, 'semester1' FROM classes WHERE id = $1 RETURNING id`,
      [G.c9A, G.math, `G9 past ${tag}`])).rows[0]?.id;
    await call(A, 'POST', '/grades', { exam_id: pastHeld, grades: [{ student_id: G.s1.sid, score: 1 }] });
    const pastSoon = (await pool.query(
      `INSERT INTO exams (class_id, subject_id, academic_year_id, name, exam_type, max_score, exam_date, semester)
       SELECT id, $2, academic_year_id, $3, 'quiz', 1, CURRENT_DATE + 3, 'semester1' FROM classes WHERE id = $1 RETURNING id`,
      [G.c9A, G.math, `G9 past soon ${tag}`])).rows[0].id;
    ok(!!pastHeld && !!pastSoon, '9A (2024/2025) exams: one undated and part-graded, one in 3 days');

    const d = await call(TA, 'GET', '/dashboard/teacher');
    ok(d.status === 200, 'teacher A gets the dashboard');
    const D = d.body.data;
    ok(D.teacher.id === G.tA.tid, 'teacher identified');
    const current = new Set(list.map((c) => c.id).concat(cls));
    const own = D.classes.find((c) => c.class_id === cls);
    ok(!!own && own.subjects.map(s => s.subject).join() === 'Mathematics' && D.classes.every((c) => current.has(c.class_id)) && !D.classes.some((c) => c.class_id === G.c9A),
      "classes: own class 9E / Mathematics; this year's classes only (9A of 2024/2025 not shown)", D.classes.map((c) => c.class_name).join());
    const act = (await pool.query("SELECT COUNT(*)::int n FROM students WHERE class_id=$1 AND status='active'", [cls])).rows[0].n;
    ok(own?.student_count === act && act === 2, 'student count matches active 9E students', `${own?.student_count}`);
    const at = D.attendance_today.find((x) => x.class_id === cls);
    ok(!!at && at.total === act && at.marked === 1 && at.absent === 1, "today's attendance for 9E (marked/absent counted)", JSON.stringify(at));
    ok(D.upcoming_exams.some(e => e.id === soon && e.days_until === 3) && D.upcoming_exams.every(e => D.classes.some((c) => c.class_name === e.class_name)), 'upcoming exams: own classes only');
    ok(!D.upcoming_exams.some((e) => e.id === pastSoon || e.class_name === 'Grade 9 Section A'), "upcoming exams: none from 9A of 2024/2025");
    ok(!D.grading_pending.some((g) => g.id === pastHeld || g.class_name === 'Grade 9 Section A'), "grading to do: none from 9A of 2024/2025", D.grading_pending.map((g) => g.class_name).join());
    const pending = D.grading_pending.find((g) => g.id === held);
    ok(!!pending && pending.graded === 1 && pending.students === 2 && !D.grading_pending.some((g) => g.id === soon)
      && D.grading_pending.every(g => g.subject_name === 'Mathematics' && g.graded < g.students), 'grading pending: own class+subject, held and incomplete only');
    if (schoolDay) ok(D.timetable_today.some(s => s.period === 7 && s.room === 'R9E' && s.class_name === 'Grade 9 Section E') && !D.timetable_today.some((s) => s.class_name === 'Grade 9 Section A'),
      `today's timetable (${todayName}): the 9E slot, not 9A's of 2024/2025`, D.timetable_today.map((s) => `${s.class_name} p${s.period}`).join());
    else ok(D.timetable_today.length === 0, "Sunday: no timetable slots today");
    const keys = []; const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } }; walk(D);
    ok(!keys.some(k => /amount|balance|payment|fee|finance|due|paid/i.test(k)), 'no finance fields in the teacher dashboard', [...new Set(keys)].join(','));
    const db2 = (await call(TB, 'GET', '/dashboard/teacher')).body.data;
    ok(db2.classes.length === 0 && db2.attendance_today.length === 0 && db2.upcoming_exams.length === 0 && db2.grading_pending.length === 0, 'teacher B (no assignments): everything empty');
    for (const [who, tok] of [['admin', A], ['principal', P], ['parent', PA]]) ok((await call(tok, 'GET', '/dashboard/teacher')).status === 403, `${who}: /dashboard/teacher -> 403`);
  } finally {
    await clear();
    if (cls) {
      await pool.query('DELETE FROM timetable WHERE class_id = $1', [cls]);
      await call(A, 'DELETE', `/teachers/${G.tA.tid}/classes/${cls}/${G.math}`);
    }
    await restoreFixtureYear(call, A);
    ok((await call(A, 'GET', '/academic-years/current')).body.data.name === FIXTURE_YEAR, `${FIXTURE_YEAR} current again`);
    const left = (await pool.query('SELECT COUNT(*)::int n FROM teacher_classes WHERE teacher_id = $1 AND class_id <> $2', [G.tA.tid, G.c9A])).rows[0].n;
    ok(left === 0, 'cleaned up: teacher A assigned to 9A only again', String(left));
  }

  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
