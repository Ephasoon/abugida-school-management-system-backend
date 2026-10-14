// Phase 2 M7a (B): classes per academic year (G2) and "copy classes from another year".
//   GET /classes (default current year, ?academic_year_id=), POST and PUT (admin): grade 1-12,
//   section A-E, capacity, homeroom teacher (active), name follows grade + section, 409 on a
//   duplicate, year fixed; audited. Copy: missing grade+sections only, no students, idempotent;
//   with copy_assignments: homeroom teachers and teacher assignments (active teachers).
//   Class lists and teachers' classes show the current year only (/timetable/classes,
//   teacher dashboard and profile). Scratch DB backend on :3100. Run via guard.sh.
const pool = require('./tdb');
const G = require('./g3.json');
const { createFreeYear } = require('./years');
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
  console.log('[g22] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const TA = await login(G.tA.email, 'Pass#2026');
  const src = (await createFreeYear(call, A, 6000, 7000)).body.data;
  const dst = (await createFreeYear(call, A, 6000, 7000)).body.data;

  console.log('== Create and edit');
  const mk = (body) => call(A, 'POST', '/classes', { academic_year_id: src.id, ...body });
  const c7a = await mk({ grade_level: 7, section: 'A', capacity: 40, homeroom_teacher_id: G.tA.tid });
  ok(c7a.status === 201 && c7a.body.data.name === 'Grade 7 Section A' && c7a.body.data.homeroom_teacher_id === G.tA.tid && c7a.body.data.capacity === 40,
    'create with a homeroom teacher', `${c7a.status} ${c7a.body?.message}`);
  const c7b = (await mk({ grade_level: 7, section: 'B' })).body.data;
  const c12a = (await mk({ grade_level: 12, section: 'A' })).body.data;
  ok(c7b.capacity === 45 && c7b.homeroom_teacher_id === null, 'defaults: capacity 45, no homeroom');
  for (const [body, label] of [[{ grade_level: 13, section: 'A' }, 'grade 13'], [{ grade_level: 7, section: 'F' }, 'section F'],
    [{ grade_level: '7', section: 'C' }, 'grade as text'], [{ grade_level: 7, section: 'C', capacity: 0 }, 'capacity 0']]) {
    const r = await mk(body);
    ok(r.status === 400, `${label} -> 400`, `${r.status} ${r.body?.message}`);
  }
  ok((await mk({ grade_level: 7, section: 'A' })).status === 409, 'duplicate grade + section in the year -> 409');
  ok((await mk({ grade_level: 8, section: 'A', homeroom_teacher_id: '00000000-0000-4000-8000-000000000000' })).body?.message === 'homeroom_teacher_id does not exist.', 'unknown homeroom teacher -> 400 naming the field');
  const inactive = (await call(A, 'POST', '/teachers', { first_name: 'Gone', last_name: `G22${tag}`, email: `g22_${tag}@asms.et` })).body.data;
  await call(A, 'PUT', `/teachers/${inactive.id}`, { is_active: false });
  ok((await mk({ grade_level: 8, section: 'A', homeroom_teacher_id: inactive.id })).status === 400, 'deactivated homeroom teacher -> 400');
  ok((await call(A, 'POST', '/classes', { grade_level: 8, section: 'A' })).status === 400, 'academic_year_id missing -> 400');

  const e1 = await call(A, 'PUT', `/classes/${c7b.id}`, { section: 'C', homeroom_teacher_id: G.tB.tid });
  ok(e1.status === 200 && e1.body.data.name === 'Grade 7 Section C' && e1.body.data.homeroom_teacher_id === G.tB.tid, 'edit: section renames the class; set a homeroom');
  ok((await call(A, 'PUT', `/classes/${c7b.id}`, { section: 'A' })).status === 409, 'edit into an existing grade + section -> 409');
  const e2 = await call(A, 'PUT', `/classes/${c7b.id}`, { homeroom_teacher_id: null });
  ok(e2.status === 200 && e2.body.data.homeroom_teacher_id === null && e2.body.data.section === 'C', 'homeroom null removes it, the rest kept');
  ok((await call(A, 'PUT', `/classes/${c7b.id}`, { academic_year_id: dst.id })).status === 400, 'the year cannot change');
  ok((await call(P, 'PUT', `/classes/${c7b.id}`, { capacity: 30 })).status === 403, 'principal cannot edit');
  ok((await call(A, 'PUT', '/classes/not-a-uuid', { capacity: 30 })).status === 404, 'malformed id -> 404');
  const audits = (await pool.query("SELECT action FROM audit_logs WHERE target_id = $1 AND action LIKE 'class.%'", [c7b.id])).rows.map((r) => r.action);
  ok(audits.join() === 'class.created,class.updated,class.updated', 'create and edits audited', audits.join());

  console.log('== Lists');
  const list = async (tok, q = '') => (await call(tok, 'GET', `/classes${q}`)).body?.data || [];
  const srcList = await list(P, `?academic_year_id=${src.id}`);
  ok(srcList.map((c) => c.name).join() === 'Grade 7 Section A,Grade 7 Section C,Grade 12 Section A', 'GET /classes?academic_year_id: ordered by grade, section (principal can read)');
  ok(srcList[0].homeroom_first_name !== undefined && srcList[0].student_count === 0, 'homeroom names and student count');
  const current = await list(TA);
  ok(current.length > 0 && !current.some((c) => c.academic_year_id === src.id), 'default: the current year only (teacher can read)');
  const tt = (await call(A, 'GET', '/timetable/classes')).body.data;
  ok(!tt.some((c) => c.academic_year_id === src.id) && tt.some((c) => c.id === G.c9A), '/timetable/classes: current year only');
  ok((await call(A, 'GET', `/timetable/classes?academic_year_id=${src.id}`)).body.data.length === 3, '/timetable/classes?academic_year_id= another year');
  ok((await call(A, 'GET', '/timetable/classes?all=true')).body.data.some((c) => c.academic_year_id === src.id), '/timetable/classes?all=true: every year');
  ok((await call(A, 'GET', '/classes?academic_year_id=nope')).status === 400, 'malformed academic_year_id -> 400');

  console.log("== Teachers see this year's classes only");
  await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: c7a.body.data.id, subject_id: G.math });
  const dash = (await call(TA, 'GET', '/dashboard/teacher')).body.data;
  ok(!dash.classes.some((c) => c.class_id === c7a.body.data.id) && dash.classes.some((c) => c.class_id === G.c9A), 'teacher dashboard: not the other year\'s class');
  const prof = (await call(A, 'GET', `/teachers/${G.tA.tid}`)).body.data;
  ok(!prof.classes.some((c) => c.id === c7a.body.data.id), 'teacher profile: not the other year\'s class');

  // A student in the source year: copying never moves students
  const st = (await call(A, 'POST', '/students', { first_name: 'Copy', last_name: `G22${tag}`, gender: 'male', class_id: c7a.body.data.id })).body.data;

  console.log('== Copy classes');
  const cp = (body) => call(A, 'POST', `/academic-years/${dst.id}/copy-classes`, body);
  ok((await cp({ from_year_id: dst.id })).status === 400, 'from the same year -> 400');
  ok((await cp({})).status === 400, 'from_year_id missing -> 400');
  ok((await cp({ from_year_id: src.id, copy_assignments: 'yes' })).status === 400, 'copy_assignments not true/false -> 400');
  await call(A, 'POST', '/classes', { academic_year_id: dst.id, grade_level: 7, section: 'A', capacity: 50 }); // already there
  const c1 = await cp({ from_year_id: src.id });
  ok(c1.status === 200 && c1.body.data.created === 2 && c1.body.data.existing === 1 && c1.body.data.assignments_copied === 0, 'copy: 2 created, 1 already there', JSON.stringify(c1.body?.data));
  const dstList = await list(A, `?academic_year_id=${dst.id}`);
  ok(dstList.map((c) => c.name).join() === 'Grade 7 Section A,Grade 7 Section C,Grade 12 Section A', 'same grades and sections');
  ok(dstList.every((c) => c.student_count === 0 && c.homeroom_teacher_id === null), 'no students, no homerooms (copy_assignments off)');
  ok(dstList[0].capacity === 50, 'an existing class is left as it was');
  const c2 = await cp({ from_year_id: src.id });
  ok(c2.status === 200 && c2.body.data.created === 0 && c2.body.data.existing === 3, 'running it again adds nothing');
  const c3 = await cp({ from_year_id: src.id, copy_assignments: true });
  const d7a = (await list(A, `?academic_year_id=${dst.id}`))[0];
  ok(c3.body.data.homerooms_copied === 1 && c3.body.data.assignments_copied === 1 && d7a.homeroom_teacher_id === G.tA.tid, 'with copy_assignments: homeroom and assignment copied', JSON.stringify(c3.body?.data));
  const c4 = await cp({ from_year_id: src.id, copy_assignments: true });
  ok(c4.body.data.homerooms_copied === 0 && c4.body.data.assignments_copied === 0, '... and again: nothing more');
  ok((await pool.query('SELECT class_id FROM students WHERE id = $1', [st.id])).rows[0].class_id === c7a.body.data.id, 'the student stays in the old class');
  ok((await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE target_id = $1 AND action = 'classes.copied'", [dst.id])).rows[0].n === 4, 'each copy audited');
  ok((await call(P, 'POST', `/academic-years/${dst.id}/copy-classes`, { from_year_id: src.id })).status === 403, 'principal cannot copy');

  // Clean up: the teacher assignments in the test years, the student
  await pool.query('DELETE FROM teacher_classes WHERE class_id IN (SELECT id FROM classes WHERE academic_year_id = ANY($1))', [[src.id, dst.id]]);
  await call(A, 'DELETE', `/students/${st.id}`);
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
