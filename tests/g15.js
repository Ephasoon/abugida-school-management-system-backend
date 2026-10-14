// Phase 2 M2 (BACKLOG "assignClass: validate input and write an audit log entry"):
// POST /teachers/:id/classes validates the teacher, class and subject, answers 409 for
// duplicates, allows subjects outside the teacher's list, and audits assign and remove.
// Scratch DB, server :3100. Run via guard.sh.
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
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

(async () => {
  console.log('[g15] db =', (await pool.query('select current_database() d')).rows[0].d);
  const started = (await pool.query('SELECT NOW() t')).rows[0].t;
  const login = async (email, password) => (await call(null, 'POST', '/auth/login', { email, password })).body?.data?.accessToken;
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const TA = await login(G.tA.email, 'Pass#2026');

  // Own teacher, so fixture teachers keep their assignments. Teaches Mathematics only.
  const created = await call(A, 'POST', '/teachers', { first_name: 'G15', last_name: `Teacher ${tag}`, email: `g15_${tag}@asms.et` });
  const tid = created.body?.data?.id;
  ok(created.status === 201 && tid, 'fixture: admin creates a teacher');
  ok((await call(A, 'POST', `/teachers/${tid}/subjects`, { subject_ids: [G.math] })).status === 200, 'fixture: teacher teaches Mathematics');
  const url = `/teachers/${tid}/classes`;
  const rows = async () => (await pool.query(
    'SELECT class_id, subject_id FROM teacher_classes WHERE teacher_id = $1', [tid])).rows;

  console.log('== Permissions');
  ok((await call(P, 'POST', url, { class_id: G.c9A, subject_id: G.math })).status === 403, 'principal cannot assign');
  ok((await call(TA, 'POST', url, { class_id: G.c9A, subject_id: G.math })).status === 403, 'teacher cannot assign');
  ok((await call(TA, 'DELETE', `${url}/${G.c9A}/${G.math}`)).status === 403, 'teacher cannot remove');

  console.log('== Input');
  ok((await call(A, 'POST', url, { class_id: G.c9A })).status === 400, 'subject_id missing -> 400');
  ok((await call(A, 'POST', url, { subject_id: G.math })).status === 400, 'class_id missing -> 400');
  for (const [label, body, field] of [
    ['unknown class_id', { class_id: UNKNOWN, subject_id: G.math }, 'class_id'],
    ['malformed class_id', { class_id: 'not-a-uuid', subject_id: G.math }, 'class_id'],
    ['numeric class_id', { class_id: 42, subject_id: G.math }, 'class_id'],
    ['unknown subject_id', { class_id: G.c9A, subject_id: UNKNOWN }, 'subject_id'],
    ['malformed subject_id', { class_id: G.c9A, subject_id: "x' OR '1'='1" }, 'subject_id'],
  ]) {
    const r = await call(A, 'POST', url, body);
    ok(r.status === 400 && r.body?.message === `${field} does not exist.`, `${label} -> 400 naming the field`, `${r.status} ${r.body?.message}`);
  }
  ok((await call(A, 'POST', `/teachers/${UNKNOWN}/classes`, { class_id: G.c9A, subject_id: G.math })).status === 404, 'unknown teacher -> 404');
  ok((await call(A, 'POST', '/teachers/not-a-uuid/classes', { class_id: G.c9A, subject_id: G.math })).status === 404, 'malformed teacher id -> 404');
  ok((await rows()).length === 0, 'nothing was saved by the refused requests');

  console.log('== Assign');
  const a1 = await call(A, 'POST', url, { class_id: G.c9A, subject_id: G.math });
  ok(a1.status === 200 && a1.body.data.class_id === G.c9A && a1.body.data.subject_id === G.math, 'subject in the teacher\'s list -> 200', a1.body?.message);
  ok(a1.body?.data?.outside_subject_list === false, 'outside_subject_list = false');
  const a2 = await call(A, 'POST', url, { class_id: G.c9A, subject_id: G.eng });
  ok(a2.status === 200, 'subject outside the teacher\'s list is allowed -> 200', a2.body?.message);
  ok(a2.body?.data?.outside_subject_list === true, 'outside_subject_list = true');
  const prof = (await call(A, 'GET', `/teachers/${tid}`)).body?.data;
  ok(prof?.classes?.length === 2, 'GET /teachers/:id lists both assignments');

  console.log('== Duplicates');
  const d = await call(A, 'POST', url, { class_id: G.c9A, subject_id: G.math });
  ok(d.status === 409 && /already assigned/.test(d.body?.message), 'same teacher, class and subject -> 409', d.body?.message);
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => call(A, 'POST', url, { class_id: G.c9B, subject_id: G.math })));
  const codes = burst.map(r => r.status).sort().join(',');
  ok(codes === '200,409,409,409,409', 'five parallel identical requests: one 200, four 409', codes);
  ok((await rows()).length === 3, 'three assignments stored, no duplicates');

  console.log('== Deactivated teacher');
  ok((await call(A, 'PUT', `/teachers/${tid}`, { is_active: false })).status === 200, 'admin deactivates the teacher');
  const inactive = await call(A, 'POST', url, { class_id: G.c9B, subject_id: G.eng });
  ok(inactive.status === 400 && /deactivated/.test(inactive.body?.message), 'assigning a deactivated teacher -> 400', inactive.body?.message);
  ok((await call(A, 'PUT', `/teachers/${tid}`, { is_active: true })).status === 200, 'admin reactivates the teacher');
  ok((await call(A, 'POST', url, { class_id: G.c9B, subject_id: G.eng })).status === 200, 'assigning works again');

  console.log('== Remove');
  ok((await call(A, 'DELETE', `${url}/${G.c9B}/${G.eng}`)).status === 200, 'admin removes an assignment');
  ok((await call(A, 'DELETE', `${url}/${G.c9B}/${G.eng}`)).status === 404, 'removing again -> 404');

  console.log('== Audit');
  const log = (await pool.query(
    `SELECT action, target_type, new_data, user_id FROM audit_logs
     WHERE target_id = $1 AND action LIKE 'teacher.class_%' AND created_at >= $2 ORDER BY created_at, id`, [tid, started])).rows;
  const actions = log.map(r => r.action).join(',');
  ok(actions === 'teacher.class_assigned,teacher.class_assigned,teacher.class_assigned,teacher.class_assigned,teacher.class_unassigned',
    'one entry per saved assignment and per removal (none for refused or duplicate requests)', actions);
  const adminId = (await pool.query("SELECT id FROM users WHERE email = 'admin@asms.et'")).rows[0].id;
  ok(log.every(r => r.target_type === 'teacher' && r.user_id === adminId), 'target teacher, written by the admin');
  ok(log[1]?.new_data?.class_id === G.c9A && log[1]?.new_data?.subject_id === G.eng && log[1]?.new_data?.outside_subject_list === true,
    'assign entry has class_id, subject_id and outside_subject_list', JSON.stringify(log[1]?.new_data));
  ok(log[4]?.new_data?.class_id === G.c9B && log[4]?.new_data?.subject_id === G.eng, 'remove entry has class_id and subject_id', JSON.stringify(log[4]?.new_data));

  // Leave nothing behind for other suites (g5 reads the assignment table): remove the
  // remaining assignments and deactivate the teacher, so it drops out of GET /teachers
  for (const r of await rows()) await call(A, 'DELETE', `${url}/${r.class_id}/${r.subject_id}`);
  await call(A, 'PUT', `/teachers/${tid}`, { is_active: false });

  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
