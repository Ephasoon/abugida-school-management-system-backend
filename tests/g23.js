// Phase 2 M7a (C): safe promotion. Preview (nothing written): per student promote (grade + 1,
// same section), repeat (excluded) or graduate (grade 12); missing target classes listed. Apply:
// preview first (confirm_count), refuses the same year, an earlier target year, missing classes,
// a changed list and a second run (also two at once); one transaction, audited, promotion_runs
// row; graduates lose their login; old records untouched. Scratch DB backend on :3100.
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
const tag = Date.now().toString(36);

(async () => {
  console.log('[g23] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');

  // Two consecutive test years: from (classes 8A, 9A, 12A with students) and to (copied classes)
  const from = (await createFreeYear(call, A, 7000, 8000)).body.data;
  let to;
  for (let y = +from.name.slice(0, 4) + 1; !to; y++) {
    const r = await call(A, 'POST', '/academic-years', { name: `${y}/${y + 1}`, start_date: `${y}-09-01`, end_date: `${y + 1}-07-31` });
    if (r.status === 201) to = r.body.data;
  }
  const cls = {};
  for (const [g, s] of [[8, 'A'], [9, 'A'], [12, 'A']]) cls[`${g}${s}`] = (await call(A, 'POST', '/classes', { academic_year_id: from.id, grade_level: g, section: s })).body.data.id;
  const stu = async (first, classKey) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G23${tag}`, gender: 'female', class_id: cls[classKey] })).body.data;
  const abeba = await stu('Abeba', '8A'), bethel = await stu('Bethel', '8A'), chaltu = await stu('Chaltu', '9A'), dina = await stu('Dina', '12A');
  const left = await stu('Eden', '8A');
  await call(A, 'DELETE', `/students/${left.id}`); // archived: not part of a promotion
  const login12 = await call(A, 'POST', `/accounts/students/${dina.id}/login`, { email: `g23_${tag}@asms.et` });
  await call(A, 'POST', '/attendance', { class_id: cls['8A'], date: '2026-01-06', records: [{ student_id: abeba.id, status: 'present' }] });
  await call(A, 'POST', `/academic-years/${to.id}/copy-classes`, { from_year_id: from.id });

  const preview = (body, year = to.id) => call(A, 'POST', `/academic-years/${year}/promotion-preview`, body);
  const apply = (body, year = to.id, tok = A) => call(tok, 'POST', `/academic-years/${year}/promote`, body);
  const classOf = async (id) => (await pool.query('SELECT class_id, status FROM students WHERE id = $1', [id])).rows[0];

  console.log('== Refused years');
  ok((await preview({ from_year_id: to.id })).status === 400, 'preview from the same year -> 400');
  const back = await preview({ from_year_id: to.id }, from.id);
  ok(back.status === 400 && /must start after/.test(back.body?.message), 'promoting into an earlier year -> 400', back.body?.message);
  ok((await apply({ from_year_id: from.id, confirm_count: 4 }, from.id)).status === 400, 'apply into the same year -> 400 (could have graduated everyone before)');
  ok((await preview({})).status === 400, 'from_year_id missing -> 400');

  console.log('== Preview');
  const p1 = await preview({ from_year_id: from.id });
  const t1 = p1.body?.data?.totals;
  ok(p1.status === 200 && t1.total === 4 && t1.promote === 3 && t1.graduate === 1 && t1.repeat === 0, 'four active students: 3 promoted, 1 graduating (archived one left out)', JSON.stringify(t1));
  const row = (data, id) => data.students.find((s) => s.student.id === id);
  ok(row(p1.body.data, abeba.id).to_class?.name === 'Grade 9 Section A' && row(p1.body.data, abeba.id).action === 'promote', '8A -> 9A of the new year');
  ok(row(p1.body.data, chaltu.id).problem === 'missing_class' && row(p1.body.data, chaltu.id).to_class === null, '9A -> 10A: missing in the new year');
  ok(p1.body.data.missing_classes.length === 1 && p1.body.data.missing_classes[0].grade_level === 10 && p1.body.data.missing_classes[0].students === 1, 'missing classes listed with counts');
  ok(row(p1.body.data, dina.id).action === 'graduate' && row(p1.body.data, dina.id).to_class === null, 'grade 12 graduates');
  ok(p1.body.data.already_run === null && Array.isArray(p1.body.data.without_class), 'not run yet; students without a class listed');
  ok((await classOf(abeba.id)).class_id === cls['8A'], 'preview wrote nothing');

  console.log('== Apply: preview first, all classes present, list unchanged');
  ok((await apply({ from_year_id: from.id })).status === 400, 'no confirm_count -> 400 (preview first)');
  ok((await apply({ from_year_id: from.id, grade_levels: [8, 9], confirm_count: 4 })).status === 400, 'the old body (grade_levels) -> 400');
  const missing = await apply({ from_year_id: from.id, confirm_count: 4 });
  ok(missing.status === 400 && /missing/.test(missing.body?.message) && missing.body?.errors?.missing_classes?.length === 1, 'a missing target class -> 400, names it', missing.body?.message);
  ok((await pool.query('SELECT COUNT(*)::int n FROM promotion_runs WHERE from_year_id = $1', [from.id])).rows[0].n === 0, '... nothing recorded');
  await call(A, 'POST', '/classes', { academic_year_id: to.id, grade_level: 10, section: 'A' });

  const p2 = await preview({ from_year_id: from.id, exclude: [bethel.id] });
  ok(p2.body.data.totals.repeat === 1 && row(p2.body.data, bethel.id).to_class?.name === 'Grade 8 Section A' && p2.body.data.totals.problems === 0,
    'excluded: repeats 8A in the new year; no problems now');
  const notHere = await preview({ from_year_id: from.id, exclude: [G.s1.sid] });
  ok(notHere.status === 400 && /not active students/.test(notHere.body?.message), 'excluding a student of another year -> 400');
  ok((await preview({ from_year_id: from.id, exclude: ['nope'] })).body?.message === 'exclude[0] does not exist.', 'a malformed excluded id -> 400 naming it');
  ok((await apply({ from_year_id: from.id, exclude: [bethel.id], confirm_count: 3 })).status === 409, 'confirm_count differs from the list -> 409 (preview again)');
  ok((await apply({ from_year_id: from.id, exclude: [bethel.id], confirm_count: 4 }, to.id, P)).status === 403, 'principal cannot apply');
  ok((await apply({ from_year_id: from.id, exclude: [bethel.id], confirm_count: 4 }, to.id, TA)).status === 403, 'teacher cannot apply');

  const done = await apply({ from_year_id: from.id, exclude: [bethel.id], confirm_count: 4 });
  ok(done.status === 200 && done.body.data.totals.promote === 2 && done.body.data.totals.repeat === 1 && done.body.data.totals.graduate === 1, 'apply: 2 promoted, 1 repeating, 1 graduated', done.body?.message);
  const newClass = async (g, s) => (await pool.query('SELECT id FROM classes WHERE academic_year_id = $1 AND grade_level = $2 AND section = $3', [to.id, g, s])).rows[0].id;
  ok((await classOf(abeba.id)).class_id === await newClass(9, 'A'), 'Abeba in 9A of the new year');
  ok((await classOf(bethel.id)).class_id === await newClass(8, 'A'), 'Bethel (excluded) in 8A of the new year');
  ok((await classOf(chaltu.id)).class_id === await newClass(10, 'A'), 'Chaltu in 10A of the new year');
  const d = await classOf(dina.id);
  ok(d.status === 'graduated' && d.class_id === cls['12A'], 'Dina graduated (class kept as history)');
  if (login12.status === 201) {
    ok((await pool.query('SELECT is_active FROM users WHERE id = (SELECT user_id FROM students WHERE id = $1)', [dina.id])).rows[0].is_active === false, "the graduate's login is disabled");
  }
  const e = await classOf(left.id);
  ok(e.class_id === cls['8A'] && e.status === 'withdrawn', 'the archived student is untouched');
  ok((await pool.query('SELECT class_id FROM attendance WHERE student_id = $1', [abeba.id])).rows[0]?.class_id === cls['8A'], "last year's attendance keeps its class");
  const run = (await pool.query('SELECT * FROM promotion_runs WHERE from_year_id = $1', [from.id])).rows[0];
  ok(run && run.to_year_id === to.id && run.promoted === 2 && run.repeated === 1 && run.graduated === 1, 'promotion_runs row with the counts');
  const au = (await pool.query("SELECT new_data FROM audit_logs WHERE target_id = $1 AND action = 'students.promoted'", [to.id])).rows;
  ok(au.length === 1 && au[0].new_data.students.length === 4 && au[0].new_data.students.find((x) => x.student_id === bethel.id)?.action === 'repeat', 'one audit entry listing every student');

  console.log('== Only once');
  const again = await apply({ from_year_id: from.id, exclude: [], confirm_count: 0 });
  ok(again.status === 409 && /already promoted/.test(again.body?.message), 'a second run -> 409', again.body?.message);
  ok((await preview({ from_year_id: from.id })).body.data.already_run?.to_year_id === to.id, 'the preview shows the run');
  const years = (await call(A, 'GET', '/academic-years')).body.data;
  ok(years.find((y) => y.id === to.id)?.promoted_from === from.name && years.find((y) => y.id === from.id)?.promoted_to === to.name, 'the year list shows promoted from / to');
  ok((await call(A, 'DELETE', `/academic-years/${to.id}`)).status === 409, 'a year used by a promotion cannot be deleted');

  // Two applies at once for another year pair: exactly one goes through
  const f2 = (await createFreeYear(call, A, 7000, 8000)).body.data;
  let t2;
  for (let y = +f2.name.slice(0, 4) + 1; !t2; y++) {
    const r = await call(A, 'POST', '/academic-years', { name: `${y}/${y + 1}`, start_date: `${y}-09-01`, end_date: `${y + 1}-07-31` });
    if (r.status === 201) t2 = r.body.data;
  }
  const c2 = (await call(A, 'POST', '/classes', { academic_year_id: f2.id, grade_level: 7, section: 'B' })).body.data.id;
  await call(A, 'POST', '/students', { first_name: 'Fikir', last_name: `G23${tag}`, gender: 'male', class_id: c2 });
  await call(A, 'POST', '/classes', { academic_year_id: t2.id, grade_level: 8, section: 'B' });
  const results = await Promise.all([1, 2, 3].map(() => apply({ from_year_id: f2.id, confirm_count: 1 }, t2.id)));
  const codes = results.map((r) => r.status).sort().join();
  ok(codes === '200,409,409', 'three applies at once: one 200, two 409', codes);

  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
