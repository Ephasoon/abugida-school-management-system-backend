// Phase 2 M5a (A, B1): two semesters. Migration 020 (semester2_start backfilled with Yekatit 1 of
// the end date's Ethiopian year, exams.semester), the exam date rules (date inside the class's
// year decides the semester; semester sent with a date must agree; a date is required; the old
// term is refused since M10, in the body and as ?term=), ?semester= filters, a changed
// semester2_start moves dated exams (with a dry run; undated exams from before keep theirs),
// raw inserts get a semester from the date (trigger). Scratch DB backend on :3100.
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
  console.log('[g26] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');

  console.log('== Migration 020 and the default');
  const fn = async (d) => (await pool.query('SELECT asms_semester2_default($1::date)::text d', [d])).rows[0].d;
  ok(await fn('2027-07-31') === '2027-02-08', '2019 E.C. (end 2027-07-31): semester 2 starts Yekatit 1 = 2027-02-08');
  ok(await fn('2025-07-31') === '2025-02-08', '2024/2025 (starts Nehase 26, 2016; 2017 E.C.): 2025-02-08');
  ok(await fn('2028-07-31') === '2028-02-09', '2020 E.C. (after a leap Pagume): 2028-02-09');
  const fx = (await pool.query("SELECT semester2_start::text s FROM academic_years WHERE name = '2024/2025'")).rows[0]?.s;
  ok(fx === '2025-02-08', 'existing year 2024/2025 backfilled with 2025-02-08', fx);
  ok((await pool.query("SELECT COUNT(*)::int n FROM exams WHERE semester IS NULL")).rows[0].n === 0, 'every exam has a semester');

  console.log('== Academic years');
  const yr = (await createFreeYear(call, A, 6000, 7000)).body.data;
  const Y = Number(yr.name.slice(0, 4));
  ok(yr.semester2_start === await fn(yr.end_date), `created without semester2_start -> the default (${yr.semester2_start})`);
  let r = await call(A, 'POST', '/academic-years', { name: `${Y + 1}/${Y + 2}`, start_date: `${Y + 1}-09-01`, end_date: `${Y + 2}-07-31`, semester2_start: `${Y + 3}-01-01` });
  ok(r.status === 400 && r.body?.errors?.field === 'semester2_start', 'semester2_start after the end -> 400');
  r = await call(A, 'POST', '/academic-years', { name: `${Y + 1}/${Y + 2}`, start_date: `${Y + 1}-09-01`, end_date: `${Y + 2}-07-31`, semester2_start: 'soon' });
  ok(r.status === 400, 'semester2_start not a date -> 400');

  // A class in the test year; semester 1 = Sept..Feb 7, semester 2 = from yr.semester2_start
  const cls = (await call(A, 'POST', '/classes', { academic_year_id: yr.id, grade_level: 9, section: 'A' })).body.data.id;
  await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: cls, subject_id: G.math });
  try {
  // Dates from the year itself (far-future test years drift: Yekatit 1 of 6532 is in March)
  const add = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const s1Date = add(yr.start_date, 60), s2Date = add(yr.semester2_start, 20);
  const exam = (tok, extra) => call(tok, 'POST', '/exam-schedule', { class_id: cls, subject_id: G.math, name: `G26 ${tag}`, exam_type: 'quiz', max_score: 10, ...extra });
  // An exam without a date (possible before M10): written straight into the scratch DB
  const undatedExam = async (semester) => (await pool.query(
    "INSERT INTO exams (class_id, subject_id, academic_year_id, name, exam_type, semester, max_score) VALUES ($1, $2, $3, $4, 'quiz', $5, 1) RETURNING id",
    [cls, G.math, yr.id, `G26 undated ${tag}`, semester])).rows[0].id;

  console.log('== Exam date rules');
  r = await exam(A, { exam_date: s1Date });
  ok(r.status === 201 && r.body.data.semester === 'semester1' && !('term' in r.body.data), `dated ${s1Date} -> semester 1 (no term)`, `${r.status} ${r.body?.message}`);
  const e1 = r.body?.data?.id;
  r = await exam(A, { exam_date: s2Date, semester: 2 });
  ok(r.status === 201 && r.body.data.semester === 'semester2', `dated ${s2Date} with semester 2 -> semester 2`);
  const e2 = r.body?.data?.id;
  r = await exam(A, { exam_date: s2Date, semester: 1 });
  ok(r.status === 400 && /semester 2/.test(r.body?.message), 'date in semester 2 but semester 1 sent -> 400', r.body?.message);
  r = await exam(A, { exam_date: add(yr.end_date, 30) });
  ok(r.status === 400 && /inside the academic year/.test(r.body?.message), 'date outside the class\'s year -> 400', r.body?.message);
  r = await exam(A, { exam_date: '2026-02-30' });
  ok(r.status === 400, 'impossible date -> 400');
  r = await exam(A, { exam_date: s2Date, term: 'term1' });
  ok(r.status === 400 && r.body?.errors?.field === 'term', 'the old term -> 400 (M10)', r.body?.message);
  r = await exam(A, { semester: 'third', exam_date: s1Date });
  ok(r.status === 400, 'semester "third" -> 400');
  r = await exam(A, { semester: 2 });
  ok(r.status === 400 && /exam_date/.test(r.body?.message), 'no date (semester 2 only) -> 400: a date is required', r.body?.message);
  ok((await call(A, 'POST', '/grades/exams', { class_id: cls, subject_id: G.math, name: 'x', exam_type: 'quiz', semester: 2 })).status === 404, 'POST /grades/exams is gone (M10) -> 404');
  await undatedExam('semester2'); await undatedExam('semester1');
  r = await exam(TA, { exam_date: s1Date });
  ok(r.status === 201 && r.body.data.semester === 'semester1' && r.body.data.academic_year_id === yr.id, "teacher: own class; the exam's year is the class's year (not the current one)");

  console.log('== Read filters');
  r = await call(A, 'GET', `/exam-schedule/class/${cls}?semester=2`);
  ok(r.status === 200 && r.body.data.length > 0 && r.body.data.every((e) => e.semester === 'semester2'), '?semester=2 -> only semester 2', `${r.body?.data?.length}`);
  r = await call(A, 'GET', `/exam-schedule/class/${cls}?term=term3`);
  ok(r.status === 400, 'old ?term= -> 400 (M10)');
  ok((await call(A, 'GET', `/exam-schedule/class/${cls}?semester=3`)).status === 400, '?semester=3 -> 400');
  r = await call(A, 'GET', `/grades/exams?class_id=${cls}&semester=1`);
  ok(r.status === 200 && r.body.data.length > 0 && r.body.data.every((e) => e.semester === 'semester1'), 'GET /grades/exams?semester=1');
  r = await call(A, 'GET', `/exam-schedule?class_id=${cls}&semester=1`);
  ok(r.status === 200 && r.body.data.every((e) => e.semester === 'semester1'), 'GET /exam-schedule?semester=1');

  console.log('== Editing an exam');
  r = await call(A, 'PUT', `/exam-schedule/${e1}`, { exam_date: s2Date });
  ok(r.status === 200 && r.body.data.semester === 'semester2', 'new date in semester 2 -> moves to semester 2');
  r = await call(A, 'PUT', `/exam-schedule/${e1}`, { semester: 1 });
  ok(r.status === 400, 'semester 1 for an exam dated in semester 2 -> 400');
  r = await call(A, 'PUT', `/exam-schedule/${e1}`, { exam_date: add(yr.start_date, -30) });
  ok(r.status === 400, 'date outside the year -> 400');
  r = await call(A, 'PUT', `/exam-schedule/${e1}`, { exam_date: s1Date, name: 'G26 renamed' });
  ok(r.status === 200 && r.body.data.semester === 'semester1' && r.body.data.name === 'G26 renamed', 'back to semester 1, renamed');

  console.log('== Changing semester 2 start moves dated exams');
  const later = add(yr.semester2_start, 50);   // after s2Date: the semester-2 exams dated s2Date move to semester 1
  const dated2 = (await pool.query("SELECT COUNT(*)::int n FROM exams WHERE class_id = $1 AND semester = 'semester2' AND exam_date IS NOT NULL AND exam_date < $2", [cls, later])).rows[0].n;
  r = await call(A, 'GET', `/academic-years/${yr.id}/semester2-preview?semester2_start=${later}`);
  ok(r.status === 200 && r.body.data.exams_moved === dated2 && r.body.data.to_semester1 === dated2 && dated2 > 0, `dry run: ${dated2} exam(s) would move to semester 1`, JSON.stringify({ moved: r.body?.data?.exams_moved }));
  ok((await pool.query("SELECT COUNT(*)::int n FROM exams WHERE class_id = $1 AND semester = 'semester2' AND exam_date < $2", [cls, later])).rows[0].n === dated2, 'dry run wrote nothing');
  ok((await call(A, 'GET', `/academic-years/${yr.id}/semester2-preview?semester2_start=${Y + 9}-01-01`)).status === 400, 'dry run: outside the year -> 400');
  ok((await call(TA, 'GET', `/academic-years/${yr.id}/semester2-preview?semester2_start=${later}`)).status === 403, 'dry run: teacher -> 403');
  const undated = (await pool.query("SELECT semester::text s FROM exams WHERE class_id = $1 AND exam_date IS NULL ORDER BY created_at", [cls])).rows.map((x) => x.s).join();
  r = await call(A, 'PUT', `/academic-years/${yr.id}`, { semester2_start: later });
  ok(r.status === 200 && r.body.data.exams_moved === dated2 && r.body.data.semester2_start === later, `PUT: ${dated2} exam(s) moved, said in the response`, r.body?.message);
  ok((await pool.query("SELECT COUNT(*)::int n FROM exams WHERE class_id = $1 AND semester = 'semester2' AND exam_date < $2", [cls, later])).rows[0].n === 0, 'dated exams now follow the new start');
  ok((await pool.query("SELECT semester::text s FROM exams WHERE class_id = $1 AND exam_date IS NULL ORDER BY created_at", [cls])).rows.map((x) => x.s).join() === undated, 'undated exams keep their semester');
  r = await call(A, 'PUT', `/academic-years/${yr.id}`, { start_date: `${Y}-12-01` });
  ok(r.status === 400 && /dated outside/.test(r.body?.message), 'new start after a dated exam -> 400', r.body?.message);
  r = await call(A, 'PUT', `/academic-years/${yr.id}`, { semester2_start: `${Y}-09-01` });
  ok(r.status === 400, 'semester2_start on the first day -> 400');

  console.log('== Raw inserts get a semester from the date (migration 026: no term fallback)');
  const raw = (await pool.query(
    "INSERT INTO exams (class_id, subject_id, academic_year_id, name, exam_type, exam_date, max_score) VALUES ($1, $2, $3, 'G26 raw', 'quiz', $4, 1) RETURNING semester::text",
    [cls, G.math, yr.id, add(yr.semester2_start, 70)])).rows[0].semester;
  ok(raw === 'semester2', 'dated in semester 2 -> the trigger takes the date');
  let refused = null;
  try { await pool.query("INSERT INTO exams (class_id, subject_id, academic_year_id, name, exam_type, max_score) VALUES ($1, $2, $3, 'G26 raw2', 'quiz', 1)", [cls, G.math, yr.id]); } catch (e) { refused = e.code; }
  ok(refused === '23502', 'no date and no semester -> refused (NOT NULL)', String(refused));
  ok(!(await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'exams' AND column_name = 'term'")).rows.length, 'exams.term is gone (026)');
  } finally {
    // Teacher A's classes are checked by g7 and g9: no assignment left behind, even after a crash
    await call(A, 'DELETE', `/teachers/${G.tA.tid}/classes/${cls}/${G.math}`);
  }

  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
