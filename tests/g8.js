// Phase 1 Group C: school-created accounts. Scratch DB backend on :3100. Run via guard.sh.
const pool = require('./tdb');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body, cookie) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const login = (email, password) => call(null, 'POST', '/auth/login', { email, password });
// Log in with a temporary password and change it; returns the new access token
const activate = async (email, temp, newPw = 'Changed#2026') => {
  const l = await login(email, temp);
  const gate = await call(l.body?.data?.accessToken, 'GET', '/auth/me');
  const ch = await call(l.body?.data?.accessToken, 'POST', '/auth/change-password', { currentPassword: temp, newPassword: newPw });
  return { must: l.body?.data?.user?.must_change_password, gate: gate.status, gateCode: gate.body?.errors?.code, token: ch.body?.data?.accessToken };
};
const tag = String(Date.now()).slice(-6);

(async () => {
  const started = (await pool.query('SELECT NOW() t')).rows[0].t;
  const A = (await login('admin@asms.et', 'Admin@1234')).body.data.accessToken;
  const P = (await login('principal.g7@asms.et', 'Pass#2026')).body.data.accessToken;
  const TA = (await login(G.tA.email, 'Pass#2026')).body.data.accessToken;
  const PA = (await login(G.parent.email, 'Pass#2026')).body.data.accessToken;

  console.log('== Only admins manage accounts');
  for (const [who, tok] of [['principal', P], ['teacher', TA], ['parent', PA]]) {
    ok((await call(tok, 'GET', '/accounts/users')).status === 403, `${who}: GET /accounts/users -> 403`);
    ok((await call(tok, 'POST', '/accounts/parents', { full_name: 'x', phone: '1', email: `x${tag}@t.et` })).status === 403, `${who}: POST /accounts/parents -> 403`);
  }

  console.log('== Student login for an existing student');
  const newStudent = async (n) => (await call(A, 'POST', '/students', { first_name: 'Acct', last_name: n + tag, gender: 'female', class_id: G.c9A })).body.data;
  const st = await newStudent('Stu');
  const sEmail = `stu${tag}@asms.et`;
  const sl = await call(A, 'POST', `/accounts/students/${st.id}/login`, { email: sEmail });
  ok(sl.status === 201 && /^[A-Za-z0-9]{12}$/.test(sl.body.data.temporary_password), 'admin creates student login (temporary password returned once)');
  ok(!sl.body.message.includes(sl.body.data.temporary_password), 'password not in the message');
  ok((await call(A, 'POST', `/accounts/students/${st.id}/login`, { email: `other${tag}@asms.et` })).status === 409, 'second login for same student -> 409');
  ok((await call(A, 'POST', `/accounts/students/${(await newStudent('Dup')).id}/login`, { email: sEmail })).status === 409, 'email already used -> 409');
  ok((await call(A, 'POST', `/accounts/students/${st.id}/login`, { email: 'not-an-email' })).status === 400, 'invalid email -> 400');
  ok((await call(A, 'POST', '/accounts/students/00000000-0000-0000-0000-000000000000/login', { email: `n${tag}@asms.et` })).status === 404, 'unknown student -> 404');
  const archived = await newStudent('Arch'); await call(A, 'DELETE', `/students/${archived.id}`);
  ok((await call(A, 'POST', `/accounts/students/${archived.id}/login`, { email: `arch${tag}@asms.et` })).status === 400, 'withdrawn student -> 400');
  const sAct = await activate(sEmail, sl.body.data.temporary_password);
  ok(sAct.must === true && sAct.gate === 403 && sAct.gateCode === 'PASSWORD_CHANGE_REQUIRED' && sAct.token, 'student must change the temporary password first');
  ok((await call(sAct.token, 'GET', `/students/${st.id}`)).status === 200, 'student reads own record');
  ok((await call(sAct.token, 'GET', `/students/${G.s1.sid}`)).status === 403, 'student cannot read another student');

  console.log('== Parent accounts and links');
  const mkParent = async (n) => call(A, 'POST', '/accounts/parents', { full_name: `Parent ${n} ${tag}`, phone: '0911' + tag, email: `par${n}${tag}@asms.et` });
  const p1 = await mkParent('One'), p2 = await mkParent('Two'), p3 = await mkParent('Three');
  ok(p1.status === 201 && p1.body.data.temporary_password && p1.body.data.user_id, 'admin creates parent profile + login');
  ok((await call(A, 'POST', '/accounts/parents', { full_name: 'X', email: `nophone${tag}@asms.et` })).status === 400, 'missing phone -> 400');
  ok((await mkParent('One')).status === 409, 'duplicate email -> 409');
  const child = await newStudent('Child');
  const link = (p, body) => call(A, 'POST', `/accounts/parents/${p.body.data.id}/children`, { student_id: child.id, ...body });
  ok((await link(p1, { relationship: 'father', is_primary: true })).status === 201, 'link parent 1 as primary father');
  ok((await link(p1, { relationship: 'father' })).status === 409, 'same link again -> 409');
  ok((await link(p2, { relationship: 'mother', is_primary: true })).status === 409, 'second primary contact -> 409');
  ok((await link(p2, { relationship: 'mother' })).status === 201, 'link parent 2 (not primary): two parents');
  ok((await link(p3, { relationship: 'guardian' })).status === 201, 'link parent 3 too (no limit)');
  ok((await link(p3, { relationship: 'uncle' })).status === 400, 'invalid relationship -> 400');
  const p1t = (await activate(`parone${tag}@asms.et`, p1.body.data.temporary_password)).token;
  const p2t = (await activate(`partwo${tag}@asms.et`, p2.body.data.temporary_password)).token;
  ok((await call(p1t, 'GET', '/parent/children')).body.data.some(c => c.id === child.id), 'parent 1 sees the child');
  ok((await call(p2t, 'GET', `/students/${child.id}`)).status === 200, 'parent 2 reads the child record');
  ok((await call(p2t, 'GET', `/students/${G.s1.sid}`)).status === 403, 'parent 2 cannot read an unlinked student');
  const lst = await call(A, 'GET', `/accounts/parents?search=${tag}`);
  const kids = lst.body.data.parents.find(x => x.id === p1.body.data.id)?.children || [];
  ok(kids.length === 1 && kids[0].relationship === 'father' && kids[0].is_primary === true, 'GET /accounts/parents lists children with relationship/primary');
  ok((await call(A, 'DELETE', `/accounts/parents/${p2.body.data.id}/children/${child.id}`)).status === 200, 'unlink parent 2');
  ok((await call(A, 'DELETE', `/accounts/parents/${p2.body.data.id}/children/${child.id}`)).status === 404, 'unlink again -> 404');
  ok((await call(p2t, 'GET', `/students/${child.id}`)).status === 403 && (await call(p2t, 'GET', '/parent/children')).body.data.length === 0, 'after unlink parent 2 loses access');
  ok((await call(p1t, 'GET', `/students/${child.id}`)).status === 200, 'parent 1 keeps access');

  console.log('== Principal accounts');
  ok((await call(A, 'POST', '/accounts/principals', { email: `pr${tag}@asms.et` })).status === 400, 'display_name required');
  const pr = await call(A, 'POST', '/accounts/principals', { email: `pr${tag}@asms.et`, display_name: 'Ato Kebede Alemu' });
  ok(pr.status === 201 && pr.body.data.role === 'principal' && pr.body.data.temporary_password, 'admin creates principal');
  const prt = (await activate(`pr${tag}@asms.et`, pr.body.data.temporary_password)).token;
  const me = (await call(prt, 'GET', '/auth/me')).body.data;
  ok(me.role === 'principal' && me.full_name === 'Ato Kebede Alemu', '/auth/me shows the display name', me.full_name);
  ok((await call(prt, 'GET', '/students')).status === 200 && (await call(prt, 'POST', '/students', { first_name: 'a', last_name: 'b', gender: 'male' })).status === 403, 'new principal: view yes, register no');

  console.log('== Admin password reset');
  const tc = await call(A, 'POST', '/teachers', { first_name: 'Reset', last_name: 'Me' + tag, email: `reset${tag}@asms.et` });
  await activate(`reset${tag}@asms.et`, tc.body.data.temporary_password, 'Known#2026');
  const before = await login(`reset${tag}@asms.et`, 'Known#2026');
  const rs = await call(A, 'POST', `/accounts/users/${tc.body.data.user_id}/reset-password`);
  ok(rs.status === 200 && /^[A-Za-z0-9]{12}$/.test(rs.body.data.temporary_password), 'reset returns a new temporary password once');
  ok((await login(`reset${tag}@asms.et`, 'Known#2026')).status === 401, 'old password no longer works');
  ok((await call(null, 'POST', '/auth/refresh', null, before.cookie)).status === 401, 'existing refresh session revoked');
  const old = await call(before.body.data.accessToken, 'GET', '/students');
  ok(old.status === 403 && old.body.errors?.code === 'PASSWORD_CHANGE_REQUIRED', 'existing access token is gated (must change password)');
  const after = await activate(`reset${tag}@asms.et`, rs.body.data.temporary_password);
  ok(after.must === true && after.token, 'login with the reset password, then forced change');
  ok((await call(A, 'POST', '/accounts/users/00000000-0000-0000-0000-000000000000/reset-password')).status === 404, 'unknown user -> 404');

  console.log('== User search');
  const us = await call(A, 'GET', `/accounts/users?role=parent&search=${tag}`);
  ok(us.status === 200 && us.body.data.users.length === 3 && us.body.data.users.every(u => u.role === 'parent' && u.parent_id), 'filter by role + search', String(us.body.data?.users?.length));
  ok((await call(A, 'GET', '/accounts/users?role=wizard')).status === 400, 'invalid role -> 400');

  const n = (await pool.query(`SELECT COUNT(*)::int n FROM audit_logs WHERE action LIKE 'account.%' AND created_at >= $1`, [started])).rows[0].n;
  ok(n === 10, 'account actions written to audit_logs (1 login, 3 parents, 3 links, 1 unlink, 1 principal, 1 reset)', `${n} entries`);
  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
