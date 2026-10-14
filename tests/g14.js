// Phase 2 G6: disable / enable a student login without archiving. Scratch DB, server :3100. Run via guard.sh.
const pool = require('./tdb');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body, cookie) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const tag = String(Date.now()).slice(-6);

(async () => {
  console.log('[g14] db =', (await pool.query('select current_database() d')).rows[0].d);
  const started = (await pool.query('SELECT NOW() t')).rows[0].t;
  const login = async (email, password) => (await call(null, 'POST', '/auth/login', { email, password })).body?.data?.accessToken;
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const TA = await login(G.tA.email, 'Pass#2026');
  const PA = await login(G.parent.email, 'Pass#2026');

  // Fixture: two active students in 9A without logins (one gets a login through the API)
  const cls = G.c9A;
  const mk = async (n) => (await pool.query(
    `INSERT INTO students (student_number, first_name, last_name, gender, class_id)
     VALUES ($1, 'G14', $2, 'female', $3) RETURNING id`, [`G14-${n}${tag}`, `Student ${n}`, cls])).rows[0].id;
  const sid = await mk('a'), noLogin = await mk('b');

  const email = `g14_${tag}@asms.et`;
  const created = await call(A, 'POST', `/accounts/students/${sid}/login`, { email });
  const tmp = created.body?.data?.temporary_password;
  const first = await call(null, 'POST', '/auth/login', { email, password: tmp });
  await call(first.body.data.accessToken, 'POST', '/auth/change-password', { currentPassword: tmp, newPassword: 'G14#Pass2026' });
  const s = await call(null, 'POST', '/auth/login', { email, password: 'G14#Pass2026' });
  const ST = s.body.data.accessToken, cookie = s.cookie;
  ok((await call(ST, 'GET', `/students/${sid}/summary`)).status === 200, 'student logs in and sees own summary');

  console.log('== Permissions and input');
  const url = `/accounts/students/${sid}/status`;
  for (const [who, tok] of [['principal', P], ['teacher', TA], ['parent', PA], ['the student', ST]]) {
    ok((await call(tok, 'PUT', url, { is_active: false })).status === 403, `${who} cannot change it`);
  }
  ok((await call(A, 'PUT', url, { is_active: 'false' })).status === 400, 'is_active must be boolean -> 400');
  ok((await call(A, 'PUT', url, {})).status === 400, 'is_active missing -> 400');
  ok((await call(A, 'PUT', '/accounts/students/00000000-0000-4000-8000-000000000000/status', { is_active: false })).status === 404, 'unknown student -> 404');
  ok((await call(A, 'PUT', '/accounts/students/not-a-uuid/status', { is_active: false })).status === 404, 'malformed id -> 404');
  const nl = await call(A, 'PUT', `/accounts/students/${noLogin}/status`, { is_active: false });
  ok(nl.status === 400 && /no login/.test(nl.body.message), 'student without a login -> 400');

  console.log('== Disable');
  const d = await call(A, 'PUT', url, { is_active: false });
  ok(d.status === 200 && d.body.data.is_active === false && d.body.data.role === 'student' && d.body.data.email === email, 'admin disables the login');
  ok((await call(ST, 'GET', `/students/${sid}/summary`)).status === 401, 'existing access token rejected immediately');
  ok((await call(null, 'POST', '/auth/refresh', null, cookie)).status === 401, 'refresh session revoked');
  ok((await call(null, 'POST', '/auth/login', { email, password: 'G14#Pass2026' })).status === 403, 'login refused while disabled');
  const st = (await pool.query('SELECT status FROM students WHERE id = $1', [sid])).rows[0].status;
  ok(st === 'active', 'student record stays active (not archived)', st);
  ok((await call(A, 'GET', `/students/${sid}`)).status === 200, 'student record still readable by admin');

  console.log('== Editing the student does not undo it');
  ok((await call(A, 'PUT', `/students/${sid}`, { phone: '0911', status: 'active' })).status === 200, 'admin edits the student (status sent unchanged)');
  ok((await call(null, 'POST', '/auth/login', { email, password: 'G14#Pass2026' })).status === 403, 'login still disabled after the edit');
  const u = (await call(A, 'GET', `/accounts/users?role=student&search=${encodeURIComponent(email)}`)).body?.data;
  const listed = (u?.users || u || []).find?.(x => x.email === email);
  ok(listed && listed.is_active === false && listed.student_id === sid, 'users list shows the login as inactive');

  console.log('== Enable');
  const e = await call(A, 'PUT', url, { is_active: true });
  ok(e.status === 200 && e.body.data.is_active === true, 'admin enables the login');
  const back = await call(null, 'POST', '/auth/login', { email, password: 'G14#Pass2026' });
  ok(back.status === 200 && (await call(back.body.data.accessToken, 'GET', `/students/${sid}/summary`)).status === 200, 'logs in again with the same password');
  ok((await call(null, 'POST', '/auth/refresh', null, cookie)).status === 401, 'old session stays revoked');

  console.log('== Archived or graduated students stay cut off');
  ok((await call(A, 'DELETE', `/students/${sid}`)).status === 200, 'admin archives the student');
  ok((await call(null, 'POST', '/auth/login', { email, password: 'G14#Pass2026' })).status === 403, 'archived: login refused');
  const en = await call(A, 'PUT', url, { is_active: true });
  ok(en.status === 400 && /withdrawn|archived|graduated|suspended|inactive/.test(en.body.message), 'enabling an archived student\'s login -> 400', en.body?.message);
  ok((await call(null, 'POST', '/auth/login', { email, password: 'G14#Pass2026' })).status === 403, 'still refused');
  ok((await call(A, 'PUT', url, { is_active: false })).status === 200, 'disabling it is still allowed');
  ok((await call(A, 'PUT', `/students/${sid}`, { status: 'active' })).status === 200, 'admin restores the student to active');
  ok((await call(null, 'POST', '/auth/login', { email, password: 'G14#Pass2026' })).status === 200, 'status change back to active enables the login (as before)');

  console.log('== Audit');
  const audit = (await pool.query(
    `SELECT action FROM audit_logs WHERE target_type = 'user' AND created_at >= $1
       AND new_data->>'email' = $2 ORDER BY created_at`, [started, email])).rows.map(r => r.action).join(',');
  ok(audit === 'account.student_deactivated,account.student_reactivated,account.student_deactivated', 'audit_logs entries', audit);

  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
