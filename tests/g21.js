// Phase 2 M7a (A): academic years. Create and edit: name "YYYY/YYYY", consecutive years, the
// first one the start date's year; end after start; duplicate names 409. Activate: one
// transaction with its audit entry. Delete: only an unused year (not current, no classes,
// exams, fee structures or payments). Audited. Scratch DB backend on :3100. Run via guard.sh.
const pool = require('./tdb');
const { createFreeYear } = require('./years');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const auditOf = async (id, action) => (await pool.query('SELECT new_data FROM audit_logs WHERE target_id = $1 AND action = $2 ORDER BY created_at', [id, action])).rows;

(async () => {
  console.log('[g21] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');

  console.log('== Create: name and dates');
  const y = await createFreeYear(call, A, 5000, 6000);
  const Y = y.body.data;
  const n = +Y.name.slice(0, 4);
  ok(y.status === 201 && Y.name === `${n}/${n + 1}` && Y.start_date === `${n}-09-01` && Y.is_current === false, 'create: name matching the start year', Y.name);
  ok((await auditOf(Y.id, 'academic_year.created')).length === 1, 'create is audited');
  const bad = async (body) => call(A, 'POST', '/academic-years', body);
  for (const [body, re, label] of [
    [{ name: `${n}-${n + 1}`, start_date: `${n}-09-01`, end_date: `${n + 1}-07-31` }, /format YYYY\/YYYY/, 'wrong format'],
    [{ name: `${n}/${n + 2}`, start_date: `${n}-09-01`, end_date: `${n + 1}-07-31` }, /consecutive/, 'years not consecutive'],
    [{ name: `${n + 1}/${n + 2}`, start_date: `${n}-09-01`, end_date: `${n + 1}-07-31` }, /start with the year of start_date/, 'name does not match the start year'],
    [{ name: `${n}/${n + 1}`, start_date: `${n}-09-01`, end_date: `${n}-08-01` }, /must be after/, 'end before start'],
    [{ name: `${n}/${n + 1}`, start_date: `${n}-13-01`, end_date: `${n + 1}-07-31` }, /valid dates/, 'invalid date'],
    [{ name: `${n}/${n + 1}` }, /required/, 'dates missing'],
  ]) {
    const r = await bad(body);
    ok(r.status === 400 && re.test(r.body?.message || ''), `${label} -> 400`, `${r.status} ${r.body?.message}`);
  }
  ok((await bad({ name: Y.name, start_date: Y.start_date, end_date: Y.end_date })).status === 409, 'duplicate name -> 409');
  // A year starting before Meskerem 1 (Sep 1) is fine: the name follows the Gregorian start year
  ok((await call(P, 'POST', '/academic-years', { name: '7000/7001', start_date: '7000-09-01', end_date: '7001-07-31' })).status === 403, 'principal cannot create');

  console.log('== Edit');
  const e1 = await call(A, 'PUT', `/academic-years/${Y.id}`, { end_date: `${n + 1}-07-10` });
  ok(e1.status === 200 && e1.body.data.end_date === `${n + 1}-07-10` && e1.body.data.name === Y.name, 'change the end date only');
  const e2 = await call(A, 'PUT', `/academic-years/${Y.id}`, { start_date: `${n + 1}-09-01` });
  ok(e2.status === 400, 'moving the start into another year without renaming -> 400', e2.body?.message);
  const e3 = await call(A, 'PUT', `/academic-years/${Y.id}`, { name: `${n}/${n + 2}` });
  ok(e3.status === 400 && /consecutive/.test(e3.body?.message), 'bad name on edit -> 400');
  const other = (await createFreeYear(call, A, 5000, 6000)).body.data;
  const e4 = await call(A, 'PUT', `/academic-years/${Y.id}`, { name: other.name, start_date: other.start_date, end_date: other.end_date });
  ok(e4.status === 409, "renaming to another year's name -> 409", `${e4.status} ${e4.body?.message}`);
  ok((await call(A, 'PUT', `/academic-years/${Y.id}`, { end_date: `${n}-08-01` })).status === 400, 'edit: end before start -> 400');
  ok((await auditOf(Y.id, 'academic_year.updated')).length === 1, 'each successful edit audited (1)');

  console.log('== Activate (and back)');
  const before = (await call(A, 'GET', '/academic-years/current')).body.data;
  const act = await call(A, 'POST', `/academic-years/${Y.id}/activate`);
  ok(act.status === 200 && act.body.data.is_current === true, 'activate');
  const cur = (await pool.query('SELECT COUNT(*)::int n FROM academic_years WHERE is_current')).rows[0].n;
  ok(cur === 1, 'exactly one current year');
  const aa = await auditOf(Y.id, 'academic_year.activated');
  ok(aa.length === 1 && aa[0].new_data.previous === before.name, 'activation audited with the previous year');
  ok((await call(A, 'POST', `/academic-years/${Y.id}/activate`)).status === 400, 'activating the active year again -> 400');
  ok((await call(A, 'DELETE', `/academic-years/${Y.id}`)).status === 409, 'the active year cannot be deleted');
  await call(A, 'POST', `/academic-years/${before.id}/activate`);
  ok((await call(A, 'GET', '/academic-years/current')).body.data.id === before.id, 'the previous year is active again');

  console.log('== Delete');
  const used = (await pool.query('SELECT c.academic_year_id AS id FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE NOT ay.is_current LIMIT 1')).rows[0]
    || { id: before.id };
  const du = await call(A, 'DELETE', `/academic-years/${used.id}`);
  ok(du.status === 409 && /cannot be deleted/.test(du.body?.message), 'a year with classes (or the active one) -> 409', du.body?.message);
  ok((await call(P, 'DELETE', `/academic-years/${other.id}`)).status === 403, 'principal cannot delete');
  const dd = await call(A, 'DELETE', `/academic-years/${other.id}`);
  ok(dd.status === 200, 'an unused year is deleted', dd.body?.message);
  ok((await pool.query('SELECT 1 FROM academic_years WHERE id = $1', [other.id])).rows.length === 0, '... gone from the database');
  ok((await auditOf(other.id, 'academic_year.deleted')).length === 1, '... and audited');
  ok((await call(A, 'DELETE', `/academic-years/${other.id}`)).status === 404, 'deleting again -> 404');
  ok((await call(A, 'DELETE', '/academic-years/not-a-uuid')).status === 404, 'malformed id -> 404');

  await call(A, 'DELETE', `/academic-years/${Y.id}`); // clean up (unused)
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
