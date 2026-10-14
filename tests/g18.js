// Phase 2 G7: parents of one student in GET /students/:id, with relationship and primary
// contact, primary first then by name, for admin and principal (and, as before, the teacher
// of the student's class and the student's own parent). Staff notes stay hidden from parents.
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

(async () => {
  console.log('[g18] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const TA = await login(G.tA.email, 'Pass#2026'), TB = await login(G.tB.email, 'Pass#2026');

  // A fresh student in 9A with three parents: Zewdu (guardian), Almaz (mother, primary), Bekele (father)
  const s = (await call(A, 'POST', '/students', { first_name: 'G18', last_name: tag, gender: 'male', class_id: G.c9A, notes: 'staff only' })).body.data;
  const mk = async (name, am) => (await call(A, 'POST', '/accounts/parents', { full_name: `${name} ${tag}`, full_name_am: am, phone: '0911000000', email: `g18_${name.toLowerCase()}_${tag}@asms.et` })).body.data;
  const zewdu = await mk('Zewdu', null), almaz = await mk('Almaz', 'አልማዝ'), bekele = await mk('Bekele', 'በቀለ');
  for (const [p, relationship, is_primary] of [[zewdu, 'guardian', false], [almaz, 'mother', true], [bekele, 'father', false]]) {
    const r = await call(A, 'POST', `/accounts/parents/${p.id}/children`, { student_id: s.id, relationship, is_primary });
    if (r.status !== 201) throw new Error(`link failed: ${r.status} ${r.body?.message}`);
  }

  for (const [who, tok] of [['admin', A], ['principal', P]]) {
    const r = await call(tok, 'GET', `/students/${s.id}`);
    const ps = r.body?.data?.parents || [];
    ok(r.status === 200 && ps.length === 3, `${who}: parents[] has the three parents`, `${r.status} ${ps.length}`);
    ok(ps.map(x => x.full_name.split(' ')[0]).join() === 'Almaz,Bekele,Zewdu', `${who}: primary contact first, then by name`, ps.map(x => x.full_name).join());
    ok(ps[0]?.relationship === 'mother' && ps[0]?.is_primary === true && ps.slice(1).every(x => x.is_primary === false), `${who}: relationship and primary contact`);
    ok(ps[0]?.full_name_am === 'አልማዝ' && ps[2]?.full_name_am === null, `${who}: Amharic name (or null)`);
    ok(['id', 'full_name', 'phone', 'phone_secondary', 'email', 'occupation'].every(k => k in ps[0]), `${who}: contact fields`);
    ok(r.body?.data?.notes === 'staff only', `${who}: staff notes shown`);
  }

  // As before: the teacher of 9A sees them, a teacher of another class does not see the student at all
  const ta = await call(TA, 'GET', `/students/${s.id}`);
  ok(ta.status === 200 && ta.body.data.parents.length === 3, "teacher of the student's class: parents shown");
  const tb = await call(TB, 'GET', `/students/${s.id}`);
  ok(tb.status === 403, "teacher of another class -> 403", `got ${tb.status}`);

  // A student without parents: empty list
  const lone = (await call(A, 'POST', '/students', { first_name: 'G18', last_name: `${tag}b`, gender: 'female', class_id: G.c9A })).body.data;
  const lr = await call(A, 'GET', `/students/${lone.id}`);
  ok(lr.status === 200 && Array.isArray(lr.body.data.parents) && lr.body.data.parents.length === 0, 'no parents -> parents: []');

  // Unlinking updates the list
  await call(A, 'DELETE', `/accounts/parents/${almaz.id}/children/${s.id}`);
  const after = (await call(P, 'GET', `/students/${s.id}`)).body?.data?.parents || [];
  ok(after.map(x => x.full_name.split(' ')[0]).join() === 'Bekele,Zewdu', 'after unlinking the primary contact: the others, by name');

  // Clean up: archive both students
  for (const id of [s.id, lone.id]) await call(A, 'DELETE', `/students/${id}`);
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
