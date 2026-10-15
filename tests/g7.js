// Phase 1 Group B: role x endpoint matrix against the scratch-DB backend on :3100.
// Run via guard.sh (DB_NAME=asms_phase0_test); fixture rows are created through tdb (scratch DB only).
const pool = require('./tdb');
const bcrypt = require('bcryptjs');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
const ABEBE = '7fc8ff6c-f082-4f54-a015-df0bb49ae61a';   // 9A, has attendance
let pass = 0, fail = 0; const fails = [];

const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : null };
};
const login = async (email, password) => (await call(null, 'POST', '/auth/login', { email, password })).body?.data?.accessToken;
const check = (cond, label, extra = '') => { if (cond) pass++; else { fail++; fails.push(label + (extra ? '  ' + extra : '')); } };

(async () => {
  console.log('[g7] db =', (await pool.query('select current_database() d')).rows[0].d);
  // ── Fixture: principal account + dated exams in 9A and 9B ──
  const pEmail = 'principal.g7@asms.et';
  await pool.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'principal')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE, must_change_password = FALSE`,
    [pEmail, bcrypt.hashSync('Pass#2026', 4)]);
  await pool.query("UPDATE users SET is_active = TRUE, must_change_password = FALSE WHERE email = ANY($1)", [[G.tA.email, G.tB.email]]);
  const ay = (await pool.query('SELECT id FROM academic_years WHERE is_current')).rows[0].id;
  const exam = async (cls, name) => (await pool.query(
    `INSERT INTO exams (class_id, subject_id, academic_year_id, name, exam_type, term, exam_date, max_score)
     VALUES ($1, $2, $3, $4, 'quiz', 'term1', CURRENT_DATE + 10, 1) RETURNING id`, [cls, G.math, ay, name])).rows[0].id;
  await exam(G.c9A, 'G7 9A quiz'); await exam(G.c9B, 'G7 9B quiz');
  const assigned = (await pool.query(`SELECT COUNT(*)::int n FROM teacher_classes WHERE teacher_id = $1`, [G.tA.tid])).rows[0].n;
  console.log(`[g7] teacher A assignments: ${assigned} (expected 9A Math) | teacher B: ${(await pool.query('SELECT COUNT(*)::int n FROM teacher_classes WHERE teacher_id=$1', [G.tB.tid])).rows[0].n}`);
  await pool.end();

  const T = {
    admin: await login('admin@asms.et', 'Admin@1234'), principal: await login(pEmail, 'Pass#2026'),
    tA: await login(G.tA.email, 'Pass#2026'), tB: await login(G.tB.email, 'Pass#2026'),
    student: await login(G.s1.email, 'Pass#2026'), parent: await login(G.parent.email, 'Pass#2026'),
  };
  for (const [k, v] of Object.entries(T)) if (!v) { console.log('login failed for', k); process.exit(1); }
  const ROLES = Object.keys(T);
  const S1 = G.s1.sid, S2 = G.s2.sid, S3 = G.s3.sid, C9A = G.c9A, C9B = G.c9B;

  // ── Matrix: [method, path, body, {role: expectedStatus}] (roles omitted = not tested) ──
  const ok = 200, created = 201, no = 403;
  const M = [
    // Students
    ['GET', '/students', null, { admin: ok, principal: ok, tA: ok, tB: ok, student: no, parent: no }],
    ['POST', '/students', { first_name: 'X', last_name: 'Y', gender: 'male' }, { principal: no, tA: no, student: no, parent: no }],
    ['GET', `/students/${S1}`, null, { admin: ok, principal: ok, tA: ok, tB: no, student: ok, parent: ok }],
    ['GET', `/students/${S2}`, null, { student: no, parent: no, tA: ok }],
    ['GET', `/students/${S3}`, null, { tA: no, principal: ok }],
    ['PUT', `/students/${S1}`, { phone: '0911' }, { principal: no, tA: no }],
    ['DELETE', `/students/${S3}`, null, { principal: no, tA: no }],
    ['GET', `/students/${S1}/summary`, null, { principal: ok, tA: ok, tB: no, student: ok, parent: ok }],
    ['GET', `/students/${S3}/summary`, null, { tA: no, student: no, parent: no }],
    // Teachers
    ['GET', '/teachers', null, { admin: ok, principal: ok, tA: no, student: no, parent: no }],
    ['GET', `/teachers/${G.tA.tid}`, null, { admin: ok, principal: ok, tA: ok, tB: no, student: no }],
    ['GET', '/teachers/subjects', null, { principal: ok, tA: ok, student: no, parent: no }],
    ['POST', '/teachers', { first_name: 'X', last_name: 'Y', email: 'x@y.z' }, { principal: no, tA: no }],
    ['POST', `/teachers/${G.tB.tid}/classes`, { class_id: C9A, subject_id: G.eng }, { principal: no, tA: no }],
    // Attendance
    // 9A's year (2024/2025) is in the past (M4): the admin marks a date inside it; teacher A is
    // refused by the date rules (teacher marking is covered by g24 on a year around today)
    ['POST', '/attendance', { class_id: C9A, date: '2025-03-03', records: [{ student_id: S1, status: 'present' }] }, { admin: created, tA: no, tB: no, principal: no, student: no, parent: no }],
    ['POST', '/attendance', { class_id: C9B, date: '2025-03-03', records: [{ student_id: S3, status: 'present' }] }, { tA: no, admin: created }],
    ['POST', '/attendance', { class_id: C9A, date: '2025-03-03', records: [{ student_id: S3, status: 'present' }] }, { tA: no }],
    ['POST', '/attendance', { date: '2025-03-03', records: [{ student_id: S1, status: 'present' }] }, { admin: 400 }],
    ['GET', `/attendance/student/${S1}`, null, { admin: ok, principal: ok, tA: ok, tB: no, student: ok, parent: ok }],
    ['GET', `/attendance/student/${S3}`, null, { tA: no, student: no, parent: no }],
    ['GET', `/attendance/report/${C9A}`, null, { principal: ok, tA: ok, tB: no, student: no, parent: no }],
    ['GET', `/attendance/${C9A}/2026-10-05`, null, { principal: ok, tA: ok, tB: no, student: no }],
    ['GET', `/attendance/${C9B}/2026-10-05`, null, { tA: no, principal: ok }],
    // Grades & report cards
    ['GET', '/grades/exams', null, { admin: ok, principal: ok, tA: ok, tB: ok, student: no, parent: no }],
    ['POST', '/grades/exams', { class_id: C9A, subject_id: G.math, name: 'p', exam_type: 'quiz', term: 'term1', max_score: 1 }, { principal: no, student: no }],
    ['GET', `/grades/report-card/${S1}`, null, { admin: ok, principal: ok, tA: ok, tB: no, student: ok, parent: ok }],
    ['GET', `/grades/report-card/${S3}`, null, { tA: no, student: no, parent: no }],
    // PDFs
    ['GET', `/pdf/report-card/${S1}`, null, { principal: ok, tA: ok, tB: no, student: ok, parent: ok }],
    ['GET', `/pdf/student-id/${S1}`, null, { admin: ok, principal: no, tA: no }],
    ['GET', `/pdf/teacher-id/${G.tA.tid}`, null, { admin: ok, principal: no, tA: no }],
    // Finance
    ['GET', '/finance/summary', null, { admin: ok, principal: ok, tA: no, student: no, parent: no }],
    ['GET', '/finance/payments', null, { principal: ok, tA: no }],
    ['GET', '/finance/unpaid', null, { principal: ok, tA: no }],
    ['GET', `/finance/student/${S1}`, null, { principal: ok, tA: no, parent: no }],
    ['POST', '/finance/payments', { student_id: S1, amount_due: 1, amount_paid: 1, payment_method: 'cash', payment_date: '2026-10-08' }, { principal: no, tA: no }],
    // Parent portal
    ['GET', '/parent/children', null, { parent: ok, admin: no, principal: no, tA: no }],
    ['GET', `/parent/child/${S1}/timetable`, null, { parent: 404 /* class has no slots -> 404 'No class assigned'? */ }],
    // Academic years
    ['GET', '/academic-years', null, { admin: ok, principal: ok, tA: no, student: no }],
    ['GET', '/academic-years/current', null, { principal: ok, tA: no }],
    ['POST', '/academic-years', { name: '2098/2099', start_date: '2098-09-01', end_date: '2099-07-31' }, { principal: no, tA: no }],
    // Timetable
    ['GET', '/timetable/classes', null, { principal: ok, tA: ok, student: no }],
    ['GET', `/timetable/class/${C9A}`, null, { admin: ok, principal: ok, tA: ok, tB: no, student: ok, parent: ok }],
    ['GET', `/timetable/class/${C9B}`, null, { tA: no, student: no, parent: no, principal: ok }],
    ['GET', `/timetable/teacher/${G.tA.tid}`, null, { principal: ok, tA: ok, tB: no, student: no }],
    ['POST', '/timetable', { class_id: C9A, subject_id: G.math, day: 'Monday', period: 1, start_time: '08:00', end_time: '09:00' }, { principal: no, tA: no }],
    // Exam schedule
    ['GET', '/exam-schedule', null, { admin: ok, principal: ok, tA: ok, tB: ok, student: ok, parent: ok }],
    ['GET', '/exam-schedule/upcoming', null, { principal: ok, tA: ok, student: ok, parent: ok }],
    ['GET', '/exam-schedule/calendar', null, { principal: ok, tA: ok, student: ok }],
    ['GET', `/exam-schedule/class/${C9A}`, null, { tA: ok, tB: no, student: ok, parent: ok }],
    ['GET', `/exam-schedule/class/${C9B}`, null, { tA: no, student: no, parent: no, principal: ok }],
    ['POST', '/exam-schedule', { class_id: C9A, subject_id: G.math, name: 'p', exam_type: 'quiz', term: 'term1', exam_date: '2025-03-12', max_score: 1 }, { principal: no, tA: created, tB: no, student: no }],   // own class+subject (Phase 1 addition)
    // Documents
    ['GET', '/documents', null, { admin: ok, principal: ok, tA: ok, student: no, parent: no }],
    ['GET', '/documents/categories', null, { principal: ok, student: no }],
    // Analytics
    ['GET', '/analytics/overview', null, { admin: ok, principal: ok, tA: no, student: no, parent: no }],
    ['GET', '/analytics/finance', null, { principal: ok, tA: no }],
    // Auth
    ['GET', '/auth/me', null, { admin: ok, principal: ok, tA: ok, student: ok, parent: ok }],
  ];
  // The parent timetable row above is a placeholder; evaluate it separately below.
  const matrix = M.filter(r => !r[1].endsWith('/timetable') || !r[1].startsWith('/parent'));

  for (const [method, path, body, exp] of matrix) {
    for (const role of ROLES) {
      if (!(role in exp)) continue;
      const r = await call(T[role], method, path, body);
      check(r.status === exp[role], `${method} ${path} as ${role}: expected ${exp[role]}, got ${r.status}`, r.status >= 500 ? JSON.stringify(r.body) : '');
    }
  }
  console.log(`matrix: ${pass} checks passed, ${fail} failed`);

  // ── Scoping of list results ──
  const classOf = async (rows, key = 'class_name') => [...new Set(rows.map(x => x[key]))].sort().join(', ');
  const studs = async (role) => (await call(T[role], 'GET', '/students?limit=200')).body.data.students;
  check((await studs('tA')).every(s => s.class_id === C9A) && (await studs('tA')).length > 0, 'teacher A student list = only 9A', await classOf(await studs('tA')));
  check((await studs('tB')).length === 0, 'teacher B (no assignments) sees no students');
  check((await studs('principal')).some(s => s.class_id === C9B) && (await studs('principal')).some(s => s.class_id === C9A), 'principal sees all classes');
  const exams = async (role) => (await call(T[role], 'GET', '/grades/exams')).body.data;
  check((await exams('tA')).every(e => e.class_id === C9A) && (await exams('tA')).length > 0, 'teacher A exam list = only 9A', await classOf(await exams('tA')));
  check((await exams('tB')).length === 0, 'teacher B exam list empty');
  for (const role of ['tA', 'student', 'parent']) {
    const sched = (await call(T[role], 'GET', '/exam-schedule')).body.data;
    check(sched.length > 0 && sched.every(e => e.class_name === 'Grade 9 Section A'), `${role}: exam schedule only 9A`, await classOf(sched));
    const up = (await call(T[role], 'GET', '/exam-schedule/upcoming?days=30')).body.data;
    check(up.some(e => e.name === 'G7 9A quiz') && !up.some(e => e.name === 'G7 9B quiz'), `${role}: upcoming has 9A quiz, not 9B`);
  }
  const pUp = (await call(T.principal, 'GET', '/exam-schedule/upcoming?days=30')).body.data;
  check(pUp.some(e => e.name === 'G7 9B quiz') && pUp.some(e => e.name === 'G7 9A quiz'), 'principal: upcoming has both classes');
  const own = (await call(T.student, 'GET', `/students/${S1}`)).body.data;
  check(own && !('notes' in own) && own.id === S1, 'student own record returned without staff notes');
  check('notes' in (await call(T.admin, 'GET', `/students/${S1}`)).body.data, 'admin still sees notes');
  const me = async (role) => (await call(T[role], 'GET', '/auth/me')).body.data;
  check((await me('principal')).full_name === 'Principal' && (await me('principal')).role === 'principal', '/auth/me principal');
  check((await me('tA')).teacher_id === G.tA.tid, '/auth/me returns teacher_id');
  check((await me('student')).student_id === S1, '/auth/me returns student_id');

  // Documents: principal sees teacher A's private doc, can upload, cannot delete
  const fd = (title) => { const f = new FormData(); f.append('file', new Blob([Buffer.from('%PDF-1.4\n')], { type: 'application/pdf' }), 'g7.pdf'); f.append('title', title); f.append('category', 'report'); f.append('is_private', 'true'); return f; };
  const up = async (tok, title) => (await (await fetch(API + '/documents/upload', { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd(title) })).json());
  const privA = await up(T.tA, 'G7 A private');
  const pUpl = await up(T.principal, 'G7 principal upload');
  check(pUpl.success, 'principal can upload');
  check((await call(T.principal, 'GET', `/documents/${privA.data.id}`)).status === 200, "principal sees teacher A's private document");
  check((await call(T.tB, 'GET', `/documents/${privA.data.id}`)).status === 404, "teacher B still cannot see it");
  check((await call(T.principal, 'DELETE', `/documents/${privA.data.id}`)).status === 403, 'principal cannot delete');
  for (const d of [privA, pUpl]) await call(T.admin, 'DELETE', `/documents/${d.data.id}`);
  // Parent child timetable still allowed (decision): 200 or 404 'No class assigned' both mean "not forbidden"
  const ptt = await call(T.parent, 'GET', `/parent/child/${S1}/timetable`);
  check(ptt.status === 200, 'parent can view child timetable', String(ptt.status));

  console.log(`\nTOTAL PASS=${pass} FAIL=${fail}`);
  fails.forEach(f => console.log('  FAIL ', f));
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
