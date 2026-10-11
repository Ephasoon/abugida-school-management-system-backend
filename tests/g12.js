// Phase 1 decisions 1, 2, 4. Scratch DB, server :3100. Run via guard.sh.
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
const sec = process.argv[2];   // optional: run one section (1, 2 or 4)

(async () => {
  const started = (await pool.query('SELECT NOW() t')).rows[0].t;
  const A = (await call(null, 'POST', '/auth/login', { email: 'admin@asms.et', password: 'Admin@1234' })).body.data.accessToken;
  const P = (await call(null, 'POST', '/auth/login', { email: 'principal.g7@asms.et', password: 'Pass#2026' })).body.data.accessToken;
  const TA = (await call(null, 'POST', '/auth/login', { email: G.tA.email, password: 'Pass#2026' })).body.data.accessToken;

  // Fixture: a parent profile WITHOUT a login, already linked to S1 (as in an existing database)
  const legacy = (await pool.query(`INSERT INTO parents (full_name, phone) VALUES ($1, '0911000999') RETURNING id`, [`Legacy Parent ${tag}`])).rows[0].id;
  await pool.query(`INSERT INTO student_parents (student_id, parent_id, relationship) VALUES ($1, $2, 'mother')`, [G.s1.sid, legacy]);

  if (!sec || sec === '1') {
    console.log('== Decision 1: login for an existing parent');
    const url = `/accounts/parents/${legacy}/login`;
    for (const [who, tok] of [['principal', P], ['teacher', TA]]) ok((await call(tok, 'POST', url, { email: `x${tag}@asms.et` })).status === 403, `${who} -> 403`);
    ok((await call(A, 'POST', url, { email: 'nope' })).status === 400, 'invalid email -> 400');
    ok((await call(A, 'POST', '/accounts/parents/00000000-0000-0000-0000-000000000000/login', { email: `y${tag}@asms.et` })).status === 404, 'unknown parent -> 404');
    ok((await call(A, 'POST', url, { email: G.tA.email })).status === 409, 'email already used -> 409');
    const r = await call(A, 'POST', url, { email: `legacy${tag}@asms.et` });
    ok(r.status === 201 && /^[A-Za-z0-9]{12}$/.test(r.body.data.temporary_password) && r.body.data.parent_id === legacy, 'admin creates the login (temporary password once)');
    ok(!r.body.message.includes(r.body.data.temporary_password), 'password not in the message');
    ok((await call(A, 'POST', url, { email: `again${tag}@asms.et` })).status === 409, 'second login for the same parent -> 409');
    const row = (await pool.query('SELECT p.full_name, p.phone, u.role, u.must_change_password FROM parents p JOIN users u ON u.id = p.user_id WHERE p.id = $1', [legacy])).rows[0];
    ok(row && row.role === 'parent' && row.must_change_password && row.phone === '0911000999', 'profile kept, login linked, must change password');
    const l = await call(null, 'POST', '/auth/login', { email: `legacy${tag}@asms.et`, password: r.body.data.temporary_password });
    const gate = await call(l.body.data.accessToken, 'GET', '/parent/children');
    ok(gate.status === 403 && gate.body.errors?.code === 'PASSWORD_CHANGE_REQUIRED', 'first login: password change required');
    const t = (await call(l.body.data.accessToken, 'POST', '/auth/change-password', { currentPassword: r.body.data.temporary_password, newPassword: 'Legacy#2026' })).body.data.accessToken;
    ok((await call(t, 'GET', '/parent/children')).body.data.some(c => c.id === G.s1.sid), 'existing child link works right away');
  }

  if (!sec || sec === '2') {
    console.log('== Decision 2: deactivate / reactivate a parent');
    const p = (await call(A, 'POST', '/accounts/parents', { full_name: `Status Parent ${tag}`, phone: '0911', email: `pst${tag}@asms.et` })).body.data;
    await call(A, 'POST', `/accounts/parents/${p.id}/children`, { student_id: G.s1.sid, relationship: 'father' });
    const l0 = await call(null, 'POST', '/auth/login', { email: `pst${tag}@asms.et`, password: p.temporary_password });
    await call(l0.body.data.accessToken, 'POST', '/auth/change-password', { currentPassword: p.temporary_password, newPassword: 'Pst#20261' });
    const s = await call(null, 'POST', '/auth/login', { email: `pst${tag}@asms.et`, password: 'Pst#20261' });
    const PT = s.body.data.accessToken, cookie = s.cookie;
    ok((await call(PT, 'GET', '/parent/children')).status === 200, 'parent is active and working');
    const url = `/accounts/parents/${p.id}/status`;
    for (const [who, tok] of [['principal', P], ['teacher', TA], ['the parent', PT]]) ok((await call(tok, 'PUT', url, { is_active: false })).status === 403, `${who} cannot change it`);
    ok((await call(A, 'PUT', url, { is_active: 'false' })).status === 400, 'is_active must be boolean -> 400');
    ok((await call(A, 'PUT', '/accounts/parents/00000000-0000-0000-0000-000000000000/status', { is_active: false })).status === 404, 'unknown parent -> 404');
    const noLogin = (await pool.query(`INSERT INTO parents (full_name, phone) VALUES ('No Login ${tag}', '0') RETURNING id`)).rows[0].id;
    ok((await call(A, 'PUT', `/accounts/parents/${noLogin}/status`, { is_active: false })).status === 400, 'parent without a login -> 400');
    const d = await call(A, 'PUT', url, { is_active: false });
    ok(d.status === 200 && d.body.data.is_active === false && d.body.data.role === 'parent', 'admin deactivates the parent');
    ok((await call(PT, 'GET', '/parent/children')).status === 401, 'existing access token rejected immediately');
    ok((await call(null, 'POST', '/auth/refresh', null, cookie)).status === 401, 'refresh session revoked');
    ok((await call(null, 'POST', '/auth/login', { email: `pst${tag}@asms.et`, password: 'Pst#20261' })).status === 403, 'login refused while deactivated');
    const r = await call(A, 'PUT', url, { is_active: true });
    const back = await call(null, 'POST', '/auth/login', { email: `pst${tag}@asms.et`, password: 'Pst#20261' });
    ok(r.status === 200 && back.status === 200 && (await call(back.body.data.accessToken, 'GET', '/parent/children')).status === 200, 'reactivated: logs in and works again (same password, links intact)');
    ok((await call(null, 'POST', '/auth/refresh', null, cookie)).status === 401, 'old session stays revoked');
    const audit = (await pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'account.parent_%activated' AND created_at >= $1 ORDER BY created_at`, [started])).rows.map(x => x.action).join();
    ok(audit === 'account.parent_deactivated,account.parent_reactivated', 'audit_logs entries', audit);
    // The refactor kept principal status working
    const pr = (await call(A, 'POST', '/accounts/principals', { email: `prs${tag}@asms.et`, display_name: 'X' })).body.data;
    ok((await call(A, 'PUT', `/accounts/principals/${pr.user_id}/status`, { is_active: false })).body?.data?.role === 'principal', 'principal status endpoint still works (shared helper)');
    ok((await call(A, 'PUT', `/accounts/principals/${p.user_id}/status`, { is_active: false })).status === 404, "a parent's user id is not a principal -> 404");
  }

  if (!sec || sec === '4') {
    console.log('== Decision 4: outstanding = per-student balances');
    const orig = (await call(A, 'GET', '/academic-years/current')).body.data;
    const y = await call(A, 'POST', '/academic-years', { name: `21${tag.slice(-2)}/21${String(+tag.slice(-2) + 1).padStart(2, '0')}`, start_date: '2031-09-01', end_date: '2032-07-31' });
    await call(A, 'POST', `/academic-years/${y.body.data.id}/activate`);
    try {
      const pay = (sid, due, paid) => call(A, 'POST', '/finance/payments', { student_id: sid, amount_due: due, amount_paid: paid, payment_method: 'cash', payment_date: '2026-10-08' });
      await pay(G.s1.sid, 10000, 10000); await pay(G.s2.sid, 8600, 8600); await pay(G.s3.sid, 5000, 4000);
      const sum = async (tok) => (await call(tok, 'GET', '/finance/summary')).body.data.summary;
      let s = await sum(A);
      ok(+s.total_expected === 23600 && +s.total_collected === 22600 && +s.total_outstanding === 1000 && +s.net_balance === 1000 && +s.total_credit === 0,
        'no overpayment: outstanding = net = 1,000, credit 0', `${s.total_outstanding}/${s.net_balance}/${s.total_credit}`);
      await pay(G.s2.sid, 0, 300);   // S2 overpays by 300
      s = await sum(A);
      ok(+s.total_outstanding === 1000, 'after a 300 overpayment: outstanding still 1,000 (debt not hidden)', s.total_outstanding);
      ok(+s.total_credit === 300 && +s.net_balance === 700, 'credit 300, net 700', `${s.total_credit} / ${s.net_balance}`);
      ok(+s.outstanding === +s.total_outstanding, 'legacy `outstanding` equals total_outstanding');
      const unpaidSum = (await call(A, 'GET', '/finance/unpaid')).body.data.reduce((a, r) => a + +r.balance, 0);
      ok(unpaidSum >= +s.total_outstanding, 'unpaid list (all years) covers at least this year\'s outstanding', `${unpaidSum}`);
      ok(+(await sum(P)).total_outstanding === 1000, 'principal sees the same figures');
      const ov = (await call(A, 'GET', '/analytics/overview')).body.data.finance;
      ok(+ov.total_outstanding === +ov.outstanding && +ov.net_balance === +ov.total_expected - +ov.total_collected && 'total_credit' in ov, 'analytics overview uses the same definitions');
    } finally {
      await call(A, 'POST', `/academic-years/${orig.id}/activate`);
    }
    ok((await call(A, 'GET', '/academic-years/current')).body.data.id === orig.id, 'original academic year re-activated');
  }

  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
