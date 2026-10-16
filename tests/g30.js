// Phase 2 M5b: clearing a saved score. POST /grades with { student_id, clear: true } removes it
// (the subject becomes incomplete), is audited with the old score, is refused in a locked
// semester, and a row cannot clear and set at once. Teachers: own class + subject only.
// Also: `locked` on GET /grades/exams/:id, the year's dates on GET /classes.
// Scratch DB backend on :3100.
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
  console.log('[g30] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const TB = await login(G.tB.email, 'Pass#2026');
  const locks = [];

  // A test year, 9A; teacher B teaches English there, teacher A teaches nothing in it
  const yr = (await createFreeYear(call, A, 7000, 8000)).body.data;
  const cls = (await call(A, 'POST', '/classes', { academic_year_id: yr.id, grade_level: 9, section: 'A' })).body.data.id;
  await call(A, 'POST', `/teachers/${G.tB.tid}/classes`, { class_id: cls, subject_id: G.eng });
  try {
    const stu = async (first) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G30${tag}`, gender: 'female', class_id: cls })).body.data.id;
    const S = { a: await stu('Abeba'), b: await stu('Bethel') };
    const exam = (await call(A, 'POST', '/grades/exams', { class_id: cls, subject_id: G.eng, name: `English ${tag}`, exam_type: 'final', max_score: 100, semester: 1 })).body.data.id;
    const save = (tok, grades) => call(tok, 'POST', '/grades', { exam_id: exam, grades });
    const scores = async () => Object.fromEntries((await call(A, 'GET', `/grades/exams/${exam}`)).body.data.grades.map((g) => [g.student_id, Number(g.score)]));
    await save(A, [{ student_id: S.a, score: 80 }, { student_id: S.b, score: 60 }]);

    console.log('== Clear');
    let r = await call(A, 'GET', `/results/student/${S.a}?academic_year_id=${yr.id}`);
    ok(r.body?.data?.semesters?.semester1?.subjects?.find((x) => x.subject_id === G.eng)?.complete === true, 'before: English complete for Abeba');
    r = await save(TB, [{ student_id: S.a, clear: true }]);
    ok(r.status === 200 && r.body.data.cleared === 1 && r.body.data.total_graded === 0, 'teacher B clears Abeba -> 200, cleared 1', `${r.status} ${r.body?.message}`);
    let now = await scores();
    ok(!(S.a in now) && now[S.b] === 60, 'Abeba has no score, Bethel keeps 60');
    r = await call(A, 'GET', `/results/student/${S.a}?academic_year_id=${yr.id}`);
    ok(r.body?.data?.semesters?.semester1?.subjects?.find((x) => x.subject_id === G.eng)?.complete === false, 'after: English incomplete for Abeba');
    const log = (await pool.query("SELECT new_data FROM audit_logs WHERE action = 'grades.score_cleared' AND target_id = $1 ORDER BY created_at DESC LIMIT 1", [exam])).rows[0]?.new_data;
    ok(log?.cleared?.[0]?.student_id === S.a && log.cleared[0].score === 80, 'audited with the old score (80)', JSON.stringify(log));
    r = await save(A, [{ student_id: S.a, clear: true }]);
    ok(r.status === 200 && r.body.data.cleared === 0, 'clearing an empty score -> 200, cleared 0');
    r = await save(A, [{ student_id: S.a, score: 75 }, { student_id: S.b, clear: true }]);
    now = await scores();
    ok(r.status === 200 && now[S.a] === 75 && !(S.b in now), 'one save sets Abeba and clears Bethel');

    console.log('== Refused');
    ok((await save(A, [{ student_id: S.a, score: 70, clear: true }])).status === 400, 'clear and a score in one row -> 400');
    ok((await save(TA, [{ student_id: S.a, clear: true }])).status === 403, 'teacher A (not assigned) -> 403');
    ok((await save(TB, [{ student_id: G.s1.sid, clear: true }])).status === 403, 'a student of another class -> 403');
    r = await call(A, 'POST', '/results/locks', { academic_year_id: yr.id, semester: 1, class_id: cls });
    locks.push(r.body?.data?.id);
    r = await save(A, [{ student_id: S.a, clear: true }]);
    ok(r.status === 409 && /locked/.test(r.body?.message), 'clearing in a locked semester -> 409', r.body?.message);
    ok((await scores())[S.a] === 75, 'the score is still there');
    ok((await call(TB, 'GET', `/grades/exams/${exam}`)).body?.data?.exam?.locked === true, 'GET /grades/exams/:id says locked');
    await call(A, 'DELETE', `/results/locks/${locks.pop()}`);
    ok((await save(A, [{ student_id: S.a, clear: true }])).status === 200, 'after unlocking: clearing works');
    ok((await call(TB, 'GET', `/grades/exams/${exam}`)).body?.data?.exam?.locked === false, 'and it is no longer locked');

    console.log('== Year dates on GET /classes (for the exam form)');
    const c = (await call(TB, 'GET', `/classes?academic_year_id=${yr.id}`)).body?.data?.find((x) => x.id === cls);
    ok(c?.year_start === yr.start_date && c.year_end === yr.end_date && c.semester2_start === yr.semester2_start, 'teacher reads the year dates and semester 2 start', JSON.stringify(c && [c.year_start, c.semester2_start]));

    for (const id of Object.values(S)) await call(A, 'DELETE', `/students/${id}`);
  } finally {
    for (const id of locks) await call(A, 'DELETE', `/results/locks/${id}`);
    await call(A, 'DELETE', `/teachers/${G.tB.tid}/classes/${cls}/${G.eng}`);
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
