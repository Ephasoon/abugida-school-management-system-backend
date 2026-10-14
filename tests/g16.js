// Phase 2 D4 (migration 018): optional Amharic names for teachers, students and parents.
// Saved on create, changed or cleared on update only when sent, searchable, and returned
// by the lists the new app uses. Also the teacher list's status filter. Scratch DB, :3100.
const pool = require('./tdb');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const tag = String(Date.now()).slice(-6);
const q = (s) => encodeURIComponent(s);

(async () => {
  console.log('[g16] db =', (await pool.query('select current_database() d')).rows[0].d);
  const cols = (await pool.query(
    `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
     WHERE column_name LIKE '%\\_am' AND table_name IN ('students','teachers','parents') ORDER BY 1`)).rows.map(r => r.c).join(',');
  ok(cols === 'parents.full_name_am,students.fathers_name_am,students.first_name_am,students.last_name_am,teachers.first_name_am,teachers.last_name_am',
    'migration 018: six nullable columns', cols);

  const login = async (email, password) => (await call(null, 'POST', '/auth/login', { email, password })).body?.data?.accessToken;
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');

  console.log('== Teachers');
  const first = `አበበ${tag}`;
  const t = await call(A, 'POST', '/teachers', { first_name: 'Abebe', last_name: `G16 ${tag}`, email: `g16_${tag}@asms.et`, first_name_am: `  ${first} `, last_name_am: 'ከበደ' });
  const tid = t.body?.data?.id;
  ok(t.status === 201 && t.body.data.first_name_am === first && t.body.data.last_name_am === 'ከበደ', 'create saves the Amharic names (trimmed)');
  const plain = await call(A, 'POST', '/teachers', { first_name: 'Plain', last_name: `G16 ${tag}`, email: `g16p_${tag}@asms.et` });
  ok(plain.status === 201 && plain.body.data.first_name_am === null, 'they are optional');
  ok((await call(A, 'POST', '/teachers', { first_name: 'X', last_name: 'Y', email: `g16x_${tag}@asms.et`, first_name_am: 'ሀ'.repeat(101) })).status === 400, 'longer than 100 characters -> 400');
  ok((await call(A, 'POST', '/teachers', { first_name: 'X', last_name: 'Y', email: `g16y_${tag}@asms.et`, last_name_am: 5 })).status === 400, 'not text -> 400');

  const prof = (await call(A, 'GET', `/teachers/${tid}`)).body?.data;
  ok(prof?.first_name_am === first && prof?.last_name_am === 'ከበደ', 'GET /teachers/:id returns them');
  for (const [term, label] of [[first, 'Amharic first name'], [`${first} ከበደ`, 'Amharic full name'], [`Abebe G16 ${tag}`, 'Latin full name'], [`g16_${tag}@`, 'email']]) {
    const list = (await call(A, 'GET', `/teachers?search=${q(term)}`)).body?.data || [];
    ok(list.length === 1 && list[0].id === tid && list[0].first_name_am === first, `list search by ${label}`, `${list.length} found`);
  }
  ok((await call(P, 'GET', `/teachers?search=${q(first)}`)).body?.data?.[0]?.last_name_am === 'ከበደ', 'principal sees them in the list');

  const u1 = await call(A, 'PUT', `/teachers/${tid}`, { phone: '0911000000' });
  ok(u1.status === 200 && u1.body.data.first_name_am === first, 'an update without the fields keeps them');
  const u2 = await call(A, 'PUT', `/teachers/${tid}`, { last_name_am: 'ተሰማ' });
  ok(u2.status === 200 && u2.body.data.last_name_am === 'ተሰማ' && u2.body.data.first_name_am === first, 'an update changes only the field sent');
  const u3 = await call(A, 'PUT', `/teachers/${tid}`, { first_name_am: '', last_name_am: null });
  ok(u3.status === 200 && u3.body.data.first_name_am === null && u3.body.data.last_name_am === null, "'' and null clear them");
  ok((await call(A, 'PUT', `/teachers/${tid}`, { first_name_am: 'ሀ'.repeat(101) })).status === 400, 'update: too long -> 400');
  ok((await call(P, 'PUT', `/teachers/${tid}`, { first_name_am: 'ሀ' })).status === 403, 'principal cannot edit');

  console.log('== Teacher list status filter');
  await call(A, 'PUT', `/teachers/${plain.body.data.id}`, { is_active: false });
  const ids = async (status) => ((await call(A, 'GET', `/teachers?search=${q(`G16 ${tag}`)}${status ? `&status=${status}` : ''}`)).body?.data || []).map(x => x.id);
  ok((await ids('')).join() === tid, 'default: active teachers only (as before)');
  ok((await ids('inactive')).join() === plain.body.data.id, 'status=inactive');
  ok((await ids('all')).length === 2, 'status=all');
  ok((await call(A, 'GET', '/teachers?status=gone')).status === 400, 'unknown status -> 400');
  const withSubjects = (await call(A, 'GET', `/teachers?search=${q(`G16 ${tag}`)}`)).body?.data?.[0];
  ok(Array.isArray(withSubjects?.subjects) || withSubjects?.subjects === null, 'list keeps subjects');
  await call(A, 'POST', `/teachers/${tid}/subjects`, { subject_ids: [G.math] });
  const ws = (await call(A, 'GET', `/teachers?search=${q(`G16 ${tag}`)}`)).body?.data?.[0];
  ok(ws?.subject_ids?.length === 1 && ws.subject_ids[0] === G.math, 'list returns subject_ids');
  const subs = (await call(A, 'GET', '/teachers/subjects')).body?.data || [];
  ok(subs.find(s => s.id === G.math)?.name_am === 'ሒሳብ', 'GET /teachers/subjects returns name_am');

  console.log('== Teacher edit: clearing optional fields');
  const filled = await call(A, 'PUT', `/teachers/${tid}`, { phone: '0911000001', specialization: 'Algebra', qualification: 'BSc' });
  ok(filled.status === 200 && filled.body.data.specialization === 'Algebra', 'set phone, specialization, qualification');
  const cleared = await call(A, 'PUT', `/teachers/${tid}`, { phone: '', specialization: null, qualification: '  ' });
  ok(cleared.status === 200 && cleared.body.data.phone === null && cleared.body.data.specialization === null && cleared.body.data.qualification === null,
    "'' / null / spaces clear them");
  const kept = await call(A, 'PUT', `/teachers/${tid}`, { qualification: 'MSc' });
  ok(kept.status === 200 && kept.body.data.qualification === 'MSc' && kept.body.data.phone === null && kept.body.data.first_name === 'Abebe', 'fields not sent are kept');
  ok((await call(A, 'PUT', `/teachers/${tid}`, { phone: '0'.repeat(21) })).status === 400, 'phone longer than 20 -> 400');
  ok((await call(A, 'PUT', `/teachers/${tid}`, { first_name: '  ' })).status === 400, 'first_name cannot be emptied -> 400');
  ok((await call(A, 'PUT', '/teachers/00000000-0000-4000-8000-000000000000', { phone: '1' })).status === 404, 'unknown teacher -> 404');

  console.log('== Audit: status and subjects');
  const auditOf = async (target, like) => (await pool.query(
    `SELECT action, new_data FROM audit_logs WHERE target_id = $1 AND action LIKE $2 ORDER BY created_at`, [target, like])).rows;
  const tUser = (await pool.query('SELECT user_id FROM teachers WHERE id = $1', [tid])).rows[0].user_id;
  await call(A, 'PUT', `/teachers/${tid}`, { is_active: false });
  await call(A, 'PUT', `/teachers/${tid}`, { is_active: false }); // no change: no second entry
  await call(A, 'PUT', `/teachers/${tid}`, { is_active: true });
  const st = await auditOf(tUser, 'account.teacher_%');
  ok(st.map(r => r.action).join() === 'account.teacher_deactivated,account.teacher_reactivated', 'deactivate and reactivate are audited (on the login, like account actions)', st.map(r => r.action).join());
  ok(st[0]?.new_data?.teacher_id === tid && st[0]?.new_data?.email === `g16_${tag}@asms.et`, 'entry names the teacher and the email');
  ok((await pool.query('SELECT is_active FROM users WHERE id = $1', [tUser])).rows[0].is_active === true, 'the login follows the status');
  ok((await call(A, 'PUT', `/teachers/${tid}`, { is_active: 'no' })).status === 400, 'is_active must be true or false -> 400');

  const eng = G.eng;
  ok((await call(A, 'POST', `/teachers/${tid}/subjects`, { subject_ids: [G.math, eng] })).status === 200, 'subjects: Mathematics + English');
  ok((await call(A, 'POST', `/teachers/${tid}/subjects`, { subject_ids: [eng] })).status === 200, 'subjects: English only');
  const sa = await auditOf(tid, 'teacher.subjects_changed');
  const last = sa[sa.length - 1]?.new_data;
  ok(sa.length === 3 && last?.removed?.join() === G.math && last?.added?.length === 0 && last?.subject_ids?.join() === eng,
    'every subject change is audited with what was added and removed', `${sa.length} entries`);
  const bad = await call(A, 'POST', `/teachers/${tid}/subjects`, { subject_ids: [eng, '00000000-0000-4000-8000-000000000000'] });
  ok(bad.status === 400 && bad.body?.message === 'subject_ids[1] does not exist.', 'an unknown or malformed subject -> 400 naming the entry', bad.body?.message);
  ok((await call(A, 'POST', `/teachers/${tid}/subjects`, { subject_ids: ['nope'] })).status === 400, 'malformed id -> 400');
  ok((await call(A, 'GET', `/teachers/${tid}`)).body?.data?.subjects?.map(x => x.id).join() === eng, '... and nothing changed');
  ok((await auditOf(tid, 'teacher.subjects_changed')).length === 3, '... and nothing audited');
  ok((await call(A, 'POST', '/teachers/00000000-0000-4000-8000-000000000000/subjects', { subject_ids: [] })).status === 404, 'unknown teacher -> 404');
  ok((await call(P, 'POST', `/teachers/${tid}/subjects`, { subject_ids: [] })).status === 403, 'principal cannot change subjects');

  console.log('== Students');
  const s = await call(A, 'POST', '/students', { first_name: 'Kebede', last_name: `G16 ${tag}`, gender: 'male', class_id: G.c9A,
    first_name_am: 'ከበደ', fathers_name_am: `አለሙ${tag}`, last_name_am: 'ታደሰ' });
  const sid = s.body?.data?.id;
  ok(s.status === 201 && s.body.data.fathers_name_am === `አለሙ${tag}`, 'register saves the Amharic names');
  const found = (await call(A, 'GET', `/students?search=${q(`አለሙ${tag}`)}`)).body?.data?.students || [];
  ok(found.length === 1 && found[0].id === sid && found[0].first_name_am === 'ከበደ' && found[0].last_name_am === 'ታደሰ', 'list search by Amharic name, fields returned');
  const su = await call(A, 'PUT', `/students/${sid}`, { phone: '0911' });
  ok(su.status === 200 && su.body.data.first_name_am === 'ከበደ', 'an edit without the fields keeps them');
  const su2 = await call(A, 'PUT', `/students/${sid}`, { last_name_am: '' });
  ok(su2.status === 200 && su2.body.data.last_name_am === null && su2.body.data.fathers_name_am === `አለሙ${tag}`, 'clearing one field keeps the others');
  ok((await call(A, 'POST', '/students', { first_name: 'X', last_name: 'Y', gender: 'male', fathers_name_am: 'ሀ'.repeat(101) })).status === 400, 'too long -> 400');

  console.log('== Parents');
  const p = await call(A, 'POST', '/accounts/parents', { full_name: `Parent G16 ${tag}`, phone: '0911223344', email: `g16par_${tag}@asms.et`, full_name_am: `ወላጅ ${tag}` });
  const pid = p.body?.data?.id;
  ok(p.status === 201 && p.body.data.full_name_am === `ወላጅ ${tag}`, 'create parent saves full_name_am');
  const pl = (await call(A, 'GET', `/accounts/parents?search=${q(`ወላጅ ${tag}`)}`)).body?.data?.parents || [];
  ok(pl.length === 1 && pl[0].id === pid && pl[0].full_name_am === `ወላጅ ${tag}`, 'parents list search by Amharic name');
  ok((await call(A, 'POST', '/accounts/parents', { full_name: 'X', phone: '09', email: `g16q_${tag}@asms.et`, full_name_am: 'ሀ'.repeat(256) })).status === 400, 'longer than 255 characters -> 400');
  await call(A, 'POST', `/accounts/parents/${pid}/children`, { student_id: sid, relationship: 'mother' });
  const det = (await call(A, 'GET', `/students/${sid}`)).body?.data;
  ok(det?.first_name_am === 'ከበደ' && det?.parents?.[0]?.full_name_am === `ወላጅ ${tag}`, "GET /students/:id returns the student's and parents' Amharic names");

  console.log('== Teacher dashboard');
  const tEmail = G.tA.email;
  await pool.query("UPDATE teachers SET first_name_am = 'ተ', last_name_am = 'ሀ' WHERE id = $1", [G.tA.tid]);
  const TA = await login(tEmail, 'Pass#2026');
  const dash = (await call(TA, 'GET', '/dashboard/teacher')).body?.data;
  ok(dash?.teacher?.first_name_am === 'ተ' && dash?.classes?.[0]?.subjects?.[0]?.subject_am !== undefined, 'dashboard returns the Amharic teacher and subject names');
  await pool.query('UPDATE teachers SET first_name_am = NULL, last_name_am = NULL WHERE id = $1', [G.tA.tid]);

  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
