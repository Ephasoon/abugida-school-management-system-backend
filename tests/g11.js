// Phase 1 addition 2: admin deactivates / reactivates a principal. Scratch DB, server :3100. Run via guard.sh.
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
  const started = (await pool.query('SELECT NOW() t')).rows[0].t;
  const A  = (await call(null, 'POST', '/auth/login', { email: 'admin@asms.et', password: 'Admin@1234' })).body.data.accessToken;
  const TA = (await call(null, 'POST', '/auth/login', { email: G.tA.email, password: 'Pass#2026' })).body.data.accessToken;

  // A fresh principal with a known password and a live session
  const email = `pstatus${tag}@asms.et`;
  const pr = (await call(A, 'POST', '/accounts/principals', { email, display_name: 'W/ro Tigist' })).body.data;
  const l0 = await call(null, 'POST', '/auth/login', { email, password: pr.temporary_password });
  await call(l0.body.data.accessToken, 'POST', '/auth/change-password', { currentPassword: pr.temporary_password, newPassword: 'Princ#2026' });
  const session = await call(null, 'POST', '/auth/login', { email, password: 'Princ#2026' });
  const PT = session.body.data.accessToken, cookie = session.cookie;
  ok((await call(PT, 'GET', '/students')).status === 200, 'principal is active and working');

  console.log('== Who may change the status');
  const url = `/accounts/principals/${pr.user_id}/status`;
  ok((await call(PT, 'PUT', url, { is_active: false })).status === 403, 'principal cannot deactivate (even themselves)');
  ok((await call(TA, 'PUT', url, { is_active: false })).status === 403, 'teacher cannot');
  ok((await call(A, 'PUT', url, { is_active: 'no' })).status === 400, 'is_active must be boolean -> 400');
  ok((await call(A, 'PUT', `/accounts/principals/${G.tA.email ? (await pool.query('SELECT user_id FROM teachers WHERE id=$1', [G.tA.tid])).rows[0].user_id : ''}/status`, { is_active: false })).status === 404, "a teacher's user id is not a principal -> 404");
  ok((await call(A, 'PUT', '/accounts/principals/00000000-0000-0000-0000-000000000000/status', { is_active: false })).status === 404, 'unknown user -> 404');
  ok((await call(TA, 'GET', '/students')).status === 200, 'teacher A unaffected by the rejected request');

  console.log('== Deactivate: immediate cut-off');
  const d = await call(A, 'PUT', url, { is_active: false });
  ok(d.status === 200 && d.body.data.is_active === false, 'admin deactivates the principal');
  ok((await call(PT, 'GET', '/students')).status === 401, 'existing access token rejected on the next request');
  ok((await call(null, 'POST', '/auth/refresh', null, cookie)).status === 401, 'refresh session revoked');
  const lg = await call(null, 'POST', '/auth/login', { email, password: 'Princ#2026' });
  ok(lg.status === 403, 'login refused while deactivated', lg.body?.message);
  const sessions = (await pool.query('SELECT COUNT(*)::int n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [pr.user_id])).rows[0].n;
  ok(sessions === 0, 'no active refresh sessions left in the database');

  console.log('== Reactivate');
  const r = await call(A, 'PUT', url, { is_active: true });
  ok(r.status === 200 && r.body.data.is_active === true, 'admin reactivates the principal');
  const back = await call(null, 'POST', '/auth/login', { email, password: 'Princ#2026' });
  ok(back.status === 200 && (await call(back.body.data.accessToken, 'GET', '/students')).status === 200, 'principal can log in and work again (same password)');
  ok((await call(null, 'POST', '/auth/refresh', null, cookie)).status === 401, 'the old session stays revoked after reactivation');

  const audit = (await pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'account.principal_%activated' AND created_at >= $1 ORDER BY created_at`, [started])).rows.map(x => x.action);
  ok(audit.join() === 'account.principal_deactivated,account.principal_reactivated', 'both changes in audit_logs', audit.join());

  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
