// Malformed and unknown ids on every route with an id parameter, against the scratch-DB backend on :3100.
// Expected: malformed id -> 404, valid-but-unknown id -> 404; 403 instead where the user may not access it
// (parent portal: a malformed or unknown id is not the parent's child).
// Never 500. Role and record-level 403s still come first.
// Run via guard.sh (DB_NAME=asms_phase0_test). AUDIT=1 prints the status table without asserting.
const crypto = require('crypto');
const pool = require('./tdb');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
const AUDIT = !!process.env.AUDIT;
let pass = 0, fail = 0; const fails = [];

const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : null };
};
const login = async (email, password) => (await call(null, 'POST', '/auth/login', { email, password })).body?.data?.accessToken;
const check = (cond, label, extra = '') => { if (cond) pass++; else { fail++; fails.push(label + (extra ? '  ' + extra : '')); } };

// Malformed ids: plain text, a number, an almost-uuid, SQL-ish text, and a uuid with trailing junk
const MALFORMED = ['not-a-uuid', '12345', '9da409a3-0000-0000-0000-00000000000', "1'%20OR%20'1'='1", `${crypto.randomUUID()}x`];
const unknown = () => crypto.randomUUID();

(async () => {
  console.log('[g13] db =', (await pool.query('select current_database() d')).rows[0].d);
  const parentId = (await pool.query('SELECT p.id FROM parents p JOIN users u ON u.id = p.user_id WHERE u.email = $1', [G.parent.email])).rows[0].id;
  const yearId = (await pool.query('SELECT id FROM academic_years WHERE is_current')).rows[0].id;
  await pool.query("UPDATE users SET is_active = TRUE, must_change_password = FALSE WHERE email = ANY($1)", [[G.tA.email, G.s1.email, G.parent.email]]);
  await pool.end();

  const T = {
    admin: await login('admin@asms.et', 'Admin@1234'), tA: await login(G.tA.email, 'Pass#2026'),
    student: await login(G.s1.email, 'Pass#2026'), parent: await login(G.parent.email, 'Pass#2026'),
  };
  for (const [k, v] of Object.entries(T)) if (!v) { console.log('login failed for', k); process.exit(1); }
  const S1 = G.s1.sid, C9A = G.c9A, MATH = G.math, TID = G.tA.tid;

  // [method, path with :params, body, role, valid values for the other params, expected status for a malformed / unknown id]
  // Every :param is tested in turn as malformed and as unknown, the others keep their valid value.
  const R = [
    ['PUT',    '/academic-years/:id',                 { name: 'X' },                          'admin'],
    ['POST',   '/academic-years/:id/activate',        null,                                   'admin'],
    ['GET',    '/academic-years/:id/stats',           null,                                   'admin'],
    ['DELETE', '/academic-years/:id',                 null,                                   'admin'],
    ['POST',   '/academic-years/:id/copy-classes',    { from_year_id: yearId },               'admin'],
    ['POST',   '/academic-years/:id/promotion-preview', { from_year_id: yearId },             'admin'],
    ['PUT',    '/classes/:id',                        { capacity: 45 },                       'admin'],
    ['POST',   '/academic-years/:id/promote',         { from_year_id: yearId },               'admin'],
    ['POST',   '/accounts/users/:userId/reset-password', null,                                'admin'],
    ['POST',   '/accounts/students/:studentId/login', { email: 'g13.none@asms.et' },          'admin'],
    ['POST',   '/accounts/parents/:parentId/login',   { email: 'g13.none@asms.et' },          'admin'],
    ['PUT',    '/accounts/parents/:parentId/status',  { is_active: true },                    'admin'],
    ['POST',   '/accounts/parents/:parentId/children', { student_id: S1, relationship: 'guardian' }, 'admin'],
    ['DELETE', '/accounts/parents/:parentId/children/:studentId', null,                       'admin', { parentId, studentId: S1 }],
    ['PUT',    '/accounts/principals/:userId/status', { is_active: true },                    'admin'],
    ['PUT',    '/attendance/:id',                     { status: 'present' },                  'admin'],
    ['GET',    '/attendance/student/:studentId',      null,                                   'admin'],
    ['GET',    '/attendance/report/:classId',         null,                                   'admin'],
    ['GET',    '/attendance/:classId/2026-10-01',     null,                                   'admin'],
    ['GET',    '/documents/student/:studentId',       null,                                   'admin'],
    ['GET',    '/documents/download/:id',             null,                                   'admin'],
    ['GET',    '/documents/:id',                      null,                                   'admin'],
    ['DELETE', '/documents/:id',                      null,                                   'admin'],
    ['GET',    '/exam-schedule/class/:classId',       null,                                   'admin'],
    ['PUT',    '/exam-schedule/:id',                  { name: 'X' },                          'admin'],
    ['DELETE', '/exam-schedule/:id',                  null,                                   'admin'],
    ['GET',    '/finance/student/:studentId',         null,                                   'admin'],
    ['GET',    '/grades/report-card/:studentId',      null,                                   'admin'],
    ['GET',    '/parent/child/:studentId/summary',    null,                                   'parent', {}, 403, 403],
    ['GET',    '/parent/child/:studentId/grades',     null,                                   'parent', {}, 403, 403],
    ['GET',    '/parent/child/:studentId/attendance', null,                                   'parent', {}, 403, 403],
    ['GET',    '/parent/child/:studentId/fees',       null,                                   'parent', {}, 403, 403],
    ['GET',    '/parent/child/:studentId/timetable',  null,                                   'parent', {}, 403, 403],
    ['GET',    '/pdf/report-card/:studentId',         null,                                   'admin'],
    ['GET',    '/pdf/student-id/:studentId',          null,                                   'admin'],
    ['GET',    '/pdf/teacher-id/:teacherId',          null,                                   'admin'],
    ['GET',    '/students/:id',                       null,                                   'admin'],
    ['PUT',    '/students/:id',                       { phone: '0911' },                      'admin'],
    ['DELETE', '/students/:id',                       null,                                   'admin'],
    ['GET',    '/students/:id/summary',               null,                                   'admin'],
    ['GET',    '/teachers/:id',                       null,                                   'admin'],
    ['PUT',    '/teachers/:id',                       { phone: '0911' },                      'admin'],
    ['POST',   '/teachers/:id/subjects',              { subject_ids: [MATH] },                'admin'],
    ['POST',   '/teachers/:id/classes',               { class_id: C9A, subject_id: MATH },    'admin'],
    ['DELETE', '/teachers/:id/classes/:classId/:subjectId', null,                             'admin', { id: TID, classId: C9A, subjectId: MATH }],
    ['GET',    '/timetable/class/:classId',           null,                                   'admin'],
    ['GET',    '/timetable/teacher/:teacherId',       null,                                   'admin'],
    ['PUT',    '/timetable/:id',                      { room: 'X' },                          'admin'],
    ['DELETE', '/timetable/:id',                      null,                                   'admin'],
  ];

  const table = [];
  for (const [method, tpl, body, role, valid = {}, malformedExpect = 404, unknownExpect = 404] of R) {
    const params = [...tpl.matchAll(/:(\w+)/g)].map(m => m[1]);
    for (const p of params) {
      const path = (v) => tpl.replace(/:(\w+)/g, (_, k) => (k === p ? v : valid[k]));
      const route = `${method} ${tpl}` + (params.length > 1 ? `  [${p}]` : '');
      const malformed = [];
      for (const bad of MALFORMED) {
        const r = await call(T[role], method, path(bad), body);
        malformed.push(r.status);
        check(r.status === malformedExpect, `${route} malformed '${bad}' -> ${malformedExpect}`, `got ${r.status} ${r.body?.message || ''}`);
      }
      const u = await call(T[role], method, path(unknown()), body);
      check(u.status === unknownExpect, `${route} unknown -> ${unknownExpect}`, `got ${u.status} ${u.body?.message || ''}`);
      table.push({ route, role, malformed: [...new Set(malformed)].join('/'), unknown: u.status });
    }
  }

  // Existing 403s stay: role checks and record-level access run before the id check
  const no = [
    ['tA',      'GET',  '/students/not-a-uuid'],                 // record access: teacher, malformed
    ['tA',      'GET',  `/students/${unknown()}/summary`],       // record access: teacher, unknown
    ['student', 'GET',  '/students/not-a-uuid/summary'],         // record access: student, malformed (g3)
    ['student', 'GET',  `/grades/report-card/${unknown()}`],     // record access: student, unknown
    ['parent',  'GET',  `/attendance/student/${unknown()}`],     // record access: parent, unknown
    ['tA',      'GET',  '/attendance/report/not-a-uuid'],        // class access: teacher, malformed
    ['tA',      'GET',  `/timetable/teacher/${unknown()}`],      // own-teacher check
    ['tA',      'GET',  '/teachers/not-a-uuid'],                 // own-teacher check, malformed
    ['tA',      'PUT',  '/students/not-a-uuid'],                 // role: admin only
    ['tA',      'GET',  '/finance/student/not-a-uuid'],          // role: school leaders only
    ['student', 'GET',  '/pdf/teacher-id/not-a-uuid'],           // role: admin only
    ['admin',   'GET',  '/parent/child/not-a-uuid/summary'],     // role: parents only
  ];
  for (const [role, method, path] of no) {
    const r = await call(T[role], method, path, method === 'GET' ? null : {});
    check(r.status === 403, `${role} ${method} ${path} -> 403`, `got ${r.status}`);
  }

  // Valid ids still work
  for (const [role, path] of [['admin', `/students/${S1}`], ['admin', `/teachers/${TID}`], ['parent', `/parent/child/${S1}/summary`], ['admin', `/attendance/${C9A}/2026-10-01`]]) {
    const r = await call(T[role], 'GET', path);
    check(r.status === 200, `${role} GET ${path} -> 200`, `got ${r.status}`);
  }

  if (AUDIT) {
    const w = Math.max(...table.map(t => t.route.length));
    console.log(`${'route'.padEnd(w)}  role    malformed  unknown`);
    for (const t of table) console.log(`${t.route.padEnd(w)}  ${t.role.padEnd(6)}  ${t.malformed.padEnd(9)}  ${t.unknown}`);
  }
  for (const f of fails) console.log('FAIL', f);
  console.log(`PASS=${pass} FAIL=${fail}`);
  console.log(fail ? 'FAILURES' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
