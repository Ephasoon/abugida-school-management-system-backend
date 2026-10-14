// Phase 2 M3: students list filters and the student edit.
//   List: status=all, bad status / gender / class_id -> 400 (never 500), filters combine, teachers
//   only their own classes (also with class_id of another class: empty), paging.
//   Edit: only the fields sent change; optional fields (incl. class and birth date) cleared with ''
//   or null; names cannot be emptied; bad gender / status / date -> 400; archive.
// Scratch DB backend on :3100. Run via guard.sh.
const pool = require('./tdb');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const tag = Date.now().toString(36);
const list = async (tok, q) => call(tok, 'GET', `/students?${q}`);

(async () => {
  console.log('[g20] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const TA = await login(G.tA.email, 'Pass#2026');

  // Four students: two in 9A (female, male), one in 9B, one archived in 9A
  const mk = async (first, gender, class_id) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G20${tag}`, gender, class_id })).body.data;
  const f9a = await mk('Abeba', 'female', G.c9A), m9a = await mk('Bekele', 'male', G.c9A), f9b = await mk('Chaltu', 'female', G.c9B), gone = await mk('Dawit', 'male', G.c9A);
  await call(A, 'DELETE', `/students/${gone.id}`);
  const names = (r) => (r.body?.data?.students || []).map((x) => x.first_name).sort().join();

  console.log('== List filters');
  ok(names(await list(A, `search=G20${tag}`)) === 'Abeba,Bekele,Chaltu', 'default: active students only');
  ok(names(await list(A, `search=G20${tag}&status=withdrawn`)) === 'Dawit', 'status=withdrawn: archived students');
  ok(names(await list(A, `search=G20${tag}&status=all`)) === 'Abeba,Bekele,Chaltu,Dawit', 'status=all');
  ok(names(await list(A, `search=G20${tag}&class_id=${G.c9A}&gender=female`)) === 'Abeba', 'class and gender combine');
  for (const [q, msg] of [['status=bogus', /status must be one of/], ['gender=x', /gender/], ['class_id=nope', /class_id does not exist/], [`class_id=${crypto.randomUUID()}`, /class_id does not exist/]]) {
    const r = await list(A, q);
    ok(r.status === 400 && msg.test(r.body?.message || ''), `${q} -> 400`, `${r.status} ${r.body?.message}`);
  }
  const p1 = await list(A, `search=G20${tag}&status=all&limit=3&page=1`), p2 = await list(A, `search=G20${tag}&status=all&limit=3&page=2`);
  ok(p1.body.data.students.length === 3 && p2.body.data.students.length === 1 && p1.body.data.pagination.total === 4 && p1.body.data.pagination.totalPages === 2, 'paging: 3 + 1 of 4');

  console.log('== Teachers: own classes only');
  ok(names(await list(TA, `search=G20${tag}`)) === 'Abeba,Bekele', 'teacher A (9A): only the 9A students');
  ok(names(await list(TA, `search=G20${tag}&class_id=${G.c9B}`)) === '', 'teacher A asking for 9B: nothing');
  ok((await list(TA, 'status=bogus')).status === 400, 'teacher: bad filter -> 400 too');

  console.log('== Edit');
  const url = `/students/${f9a.id}`;
  const e1 = await call(A, 'PUT', url, { phone: '0911000001', address: 'Bole', fathers_name: 'Girma', date_of_birth: '2012-09-11', first_name_am: 'አበባ' });
  ok(e1.status === 200 && e1.body.data.phone === '0911000001' && e1.body.data.date_of_birth === '2012-09-11' && e1.body.data.first_name_am === 'አበባ', 'set optional fields');
  const e2 = await call(A, 'PUT', url, { phone: '', address: null, fathers_name: '', date_of_birth: '' });
  ok(e2.status === 200 && e2.body.data.phone === null && e2.body.data.address === null && e2.body.data.fathers_name === null && e2.body.data.date_of_birth === null,
    "'' / null clear phone, address, father's name, birth date");
  ok(e2.body.data.first_name_am === 'አበባ' && e2.body.data.first_name === 'Abeba' && e2.body.data.class_id === G.c9A, 'fields not sent are kept');
  const e3 = await call(A, 'PUT', url, { class_id: G.c9B });
  ok(e3.status === 200 && e3.body.data.class_id === G.c9B, 'move to another class');
  const e4 = await call(A, 'PUT', url, { class_id: null });
  ok(e4.status === 200 && e4.body.data.class_id === null, 'class_id null: no class');
  await call(A, 'PUT', url, { class_id: G.c9A });
  for (const [body, label] of [[{ first_name: ' ' }, 'first_name emptied'], [{ last_name: null }, 'last_name null'], [{ gender: 'x' }, 'bad gender'],
    [{ status: 'gone' }, 'bad status'], [{ date_of_birth: '2012-13-40' }, 'bad date'], [{ phone: '1'.repeat(21) }, 'phone too long'], [{ address: 5 }, 'address not text']]) {
    const r = await call(A, 'PUT', url, body);
    ok(r.status === 400, `${label} -> 400`, `${r.status} ${r.body?.message}`);
  }
  ok((await call(A, 'POST', '/students', { first_name: 'X', last_name: 'Y', gender: 'male', date_of_birth: 'yesterday' })).status === 400, 'create with a bad date -> 400');
  const audit = (await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE target_id = $1 AND action = 'student.updated'", [f9a.id])).rows[0].n;
  ok(audit === 5, 'each successful edit audited (5)', String(audit));

  const yr = (await pool.query("SELECT ay.name, to_char(ay.end_date, 'YYYY-MM-DD') AS end_date FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = $1", [G.c9A])).rows[0];
  const det = (await call(A, 'GET', url)).body?.data;
  ok(det?.academic_year === yr.name && det?.academic_year_end === yr.end_date, "profile: the class's academic year with its end date (for the E.C. label)", `${det?.academic_year} ${det?.academic_year_end}`);

  console.log('== Archive');
  const ar = await call(A, 'DELETE', `/students/${m9a.id}`);
  ok(ar.status === 200 && names(await list(A, `search=G20${tag}`)) === 'Abeba,Chaltu', 'archive: no longer in the active list');
  ok((await call(A, 'GET', `/students/${m9a.id}`)).body?.data?.status === 'withdrawn', 'status withdrawn, record kept');

  for (const s of [f9a, f9b]) await call(A, 'DELETE', `/students/${s.id}`);
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
