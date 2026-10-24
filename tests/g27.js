// Phase 2 M5a (B, B2): results out of 100 with fixed fixtures. Subject score = sum of the
// assessment scores (D15), totals, averages, ranks with ties 1, 2, 2, 4 and incomplete
// students not ranked (D16), both semesters and the yearly figures, promotion by the pass mark
// and manual promotion grades (D17, D26), days absent per semester (D28), moving to another
// class not changing old results, max scores over 100 refused (D25, also two at once),
// G1 (one exam + its scores), the report card wrapper (no GPA / letters), settings (audited),
// analytics score bands (D18), scoping. Scratch DB backend on :3100.
const pool = require('./tdb');
const { newExam } = require('./exams');
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
  console.log('[g27] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const TB = await login(G.tB.email, 'Pass#2026');
  const PA = await login(G.parent.email, 'Pass#2026');
  const setting = (key, value, tok = A) => call(tok, 'PUT', `/settings/${key}`, { value });

  // ── Fixtures: a test year, class 9A (results) and 10A (moves, concurrency) ──
  const yr = (await createFreeYear(call, A, 6000, 7000)).body.data;
  const cls = (await call(A, 'POST', '/classes', { academic_year_id: yr.id, grade_level: 9, section: 'A' })).body.data.id;
  const next = (await call(A, 'POST', '/classes', { academic_year_id: yr.id, grade_level: 10, section: 'A' })).body.data.id;
  await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: cls, subject_id: G.math });
  try {
    const stu = async (first) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G27${tag}`, gender: 'female', class_id: cls })).body.data.id;
    const S = {};
    for (const n of ['abe', 'bet', 'chu', 'dan', 'eli', 'fay']) S[n] = await stu(n[0].toUpperCase() + n.slice(1));
    const exam = async (subject, name, max, semester, class_id = cls) => newExam(call, A,
      { class_id, subject_id: subject, name: `${name} ${tag}`, exam_type: 'quiz', max_score: max, semester });
    const E = {};
    for (const sem of [1, 2]) {
      E[`m${sem}a`] = (await exam(G.math, `Math quiz s${sem}`, 40, sem)).body.data.id;
      E[`m${sem}b`] = (await exam(G.math, `Math final s${sem}`, 60, sem)).body.data.id;
      E[`e${sem}a`] = (await exam(G.eng, `Eng mid s${sem}`, 50, sem)).body.data.id;
      E[`e${sem}b`] = (await exam(G.eng, `Eng final s${sem}`, 50, sem)).body.data.id;
    }
    const enter = (examId, pairs) => call(A, 'POST', '/grades', { exam_id: examId, grades: pairs.map(([k, score]) => ({ student_id: S[k], score })) });
    // Semester 1: abe 90, bet 80, chu 80 (tie), dan 70, eli incomplete (English final missing), fay nothing
    let r = await enter(E.m1a, [['abe', 36], ['bet', 30], ['chu', 35], ['dan', 28], ['eli', 40]]);
    ok(r.status === 200 && !JSON.stringify(r.body).includes('grade_letter'), 'scores saved, no grade letter in the response');
    await enter(E.m1b, [['abe', 54], ['bet', 50], ['chu', 45], ['dan', 42], ['eli', 60]]);
    await enter(E.e1a, [['abe', 45], ['bet', 40], ['chu', 38], ['dan', 35], ['eli', 50]]);
    await enter(E.e1b, [['abe', 45], ['bet', 40], ['chu', 42], ['dan', 35]]);
    // Semester 2: abe 80, bet 90, chu 70, dan 40, eli 60 (complete)
    await enter(E.m2a, [['abe', 32], ['bet', 36], ['chu', 28], ['dan', 16], ['eli', 24]]);
    await enter(E.m2b, [['abe', 48], ['bet', 54], ['chu', 42], ['dan', 24], ['eli', 36]]);
    await enter(E.e2a, [['abe', 40], ['bet', 45], ['chu', 35], ['dan', 20], ['eli', 30]]);
    await enter(E.e2b, [['abe', 40], ['bet', 45], ['chu', 35], ['dan', 20], ['eli', 30]]);
    ok(!(await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'grades' AND column_name = 'grade_letter'")).rows.length, 'no letters: grades.grade_letter is gone (026)');

    console.log('== Semester 1: totals, averages, ranks 1, 2, 2, 4');
    r = await call(A, 'GET', `/results/class/${cls}?semester=1`);
    const s1 = r.body?.data;
    const row = (data, k) => data.students.find((x) => x.student_id === S[k]);
    ok(r.status === 200 && s1.subjects.length === 2 && s1.subjects.every((x) => x.max_total === 100 && x.status === 'ok'), 'two subjects, each 100 in max scores');
    ok(row(s1, 'abe').subjects[G.math].score === 90 && row(s1, 'abe').total === 180 && row(s1, 'abe').average === 90, 'Abe: math 36 + 54 = 90, total 180, average 90');
    ok([row(s1, 'abe').rank, row(s1, 'bet').rank, row(s1, 'chu').rank, row(s1, 'dan').rank].join() === '1,2,2,4', 'ranks 1, 2, 2, 4', [row(s1, 'abe').rank, row(s1, 'bet').rank, row(s1, 'chu').rank, row(s1, 'dan').rank].join());
    ok(row(s1, 'eli').complete === false && row(s1, 'eli').rank === null && row(s1, 'fay').rank === null, 'Eli (a score missing) and Fay (none) not ranked');
    ok(s1.ranked_count === 4 && s1.class_size === 6, 'ranked 4 of a class of 6', `${s1.ranked_count}/${s1.class_size}`);
    ok(row(s1, 'eli').subjects[G.eng].complete === false && row(s1, 'eli').subjects[G.eng].score === 50, 'Eli English: 50 so far, incomplete');

    console.log('== Year');
    r = await call(A, 'GET', `/results/class/${cls}?semester=year`);
    const y = r.body?.data;
    ok(r.status === 200 && row(y, 'abe').yearly_average === 85 && row(y, 'bet').yearly_average === 85, 'yearly average = (s1 + s2) / 2: Abe 85, Bet 85');
    ok(row(y, 'abe').yearly_rank === 1 && row(y, 'bet').yearly_rank === 1 && row(y, 'chu').yearly_rank === 3 && row(y, 'dan').yearly_rank === 4, 'yearly ranks 1, 1, 3, 4');
    ok(row(y, 'eli').yearly_average === null && row(y, 'eli').yearly_rank === null, 'Eli: semester 1 not ranked -> no yearly result');
    ok(row(y, 'abe').yearly_subjects[G.math] === 85, 'yearly subject score = average of the semesters (math 90, 80 -> 85)');
    ok(row(y, 'dan').promotion?.status === 'promoted' && row(y, 'eli').promotion === null, 'pass mark 50: Dan (55) promoted; Eli no result');

    console.log('== Pass mark and manual promotion grades (settings, audited)');
    ok((await setting('pass_yearly_average', 60, TA)).status === 403, 'teacher cannot change settings');
    ok((await setting('pass_yearly_average', 101)).status === 400, 'pass mark 101 -> 400');
    ok((await setting('pass_yearly_average', '60')).status === 400, 'pass mark as text -> 400');
    ok((await setting('manual_promotion_grades', [6, 6])).status === 400, 'duplicate grades -> 400');
    ok((await setting('colour', 'blue')).status === 404, 'unknown setting -> 404');
    ok((await call(TA, 'GET', '/settings')).status === 200, 'staff read the settings');
    r = await setting('pass_yearly_average', 60);
    ok(r.status === 200 && (await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action = 'settings.updated' AND new_data->>'key' = 'pass_yearly_average' AND created_at > NOW() - INTERVAL '1 minute'")).rows[0].n >= 1, 'pass mark 60 saved and audited');
    r = await call(A, 'GET', `/results/class/${cls}?semester=year`);
    ok(row(r.body.data, 'dan').promotion?.status === 'not_promoted' && row(r.body.data, 'chu').promotion?.status === 'promoted', 'pass mark 60: Dan (55) not promoted, Chu (75) promoted');
    await setting('manual_promotion_grades', [12, 9]);
    r = await call(A, 'GET', `/results/class/${cls}?semester=year`);
    ok(r.body.data.students.filter((x) => x.yearly_rank).every((x) => x.promotion?.status === 'pending'), 'grade 9 in manual_promotion_grades -> "pending" for every ranked student');
    ok(JSON.stringify((await call(A, 'GET', '/settings')).body.data.manual_promotion_grades) === '[9,12]', 'manual grades stored sorted');
    await setting('manual_promotion_grades', []);
    await setting('pass_yearly_average', 50);

    console.log('== Student results, report card, days absent');
    const s1Day = (n) => { const d = new Date(`${yr.start_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const s2Day = (n) => { const d = new Date(`${yr.semester2_start}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    for (const [date, status] of [[s1Day(10), 'absent'], [s1Day(11), 'absent'], [s1Day(12), 'late'], [s1Day(13), 'excused'], [s2Day(5), 'absent']]) {
      await pool.query('INSERT INTO attendance (student_id, class_id, date, status) VALUES ($1, $2, $3, $4)', [S.abe, cls, date, status]);
    }
    r = await call(A, 'GET', `/results/student/${S.abe}?academic_year_id=${yr.id}`);
    const me = r.body?.data;
    ok(r.status === 200 && me.semesters.semester1.rank === 1 && me.semesters.semester1.ranked_count === 4 && me.year.average === 85 && me.year.rank === 1, 'student results: semester 1 rank 1 of 4, year 85, rank 1');
    ok(me.semesters.semester1.days_absent === 2 && me.semesters.semester1.days_late === 1 && me.semesters.semester1.days_excused === 1 && me.semesters.semester2.days_absent === 1, 'days absent per semester: 2 and 1 (late, excused counted apart)');
    ok(me.year.promotion?.status === 'promoted' && me.settings.pass_yearly_average === 50, 'promotion: promoted (pass mark 50)');
    r = await call(A, 'GET', `/grades/report-card/${S.abe}?semester=1&academic_year_id=${yr.id}`);
    const rc = r.body?.data;
    ok(r.status === 200 && !('gpa' in rc.academic_summary) && rc.academic_summary.rank === 1 && rc.academic_summary.total_in_class === 4 && rc.subjects.every((x) => !('grade_letter' in x)), 'report card: same rank as the results, no GPA or letters (M10: not even placeholders)');
    ok(rc.subjects.find((x) => x.subject_id === undefined && x.score === 90) !== undefined, 'report card subject scores out of 100');
    r = await call(A, 'GET', `/grades/report-card/${S.abe}?academic_year_id=${yr.id}`);
    ok(r.body?.data?.academic_summary?.result === 'Promoted', 'report card for the year: "Promoted"');

    console.log('== Moving to another class keeps old results');
    await call(A, 'PUT', `/students/${S.bet}`, { class_id: next });
    r = await call(A, 'GET', `/results/class/${cls}?semester=1`);
    ok(row(r.body.data, 'bet')?.rank === 2 && row(r.body.data, 'bet')?.in_class_now === false, 'Bet moved to 10A: still rank 2 in 9A semester 1');

    console.log('== Max scores over 100 refused (D25)');
    r = await exam(G.math, 'Extra', 10, 1);
    ok(r.status === 400 && /would total 110 \(already 100 \+ this 10\)/.test(r.body?.message), 'math semester 1 already 100: +10 -> 400 naming the numbers', r.body?.message);
    r = await call(A, 'PUT', `/exam-schedule/${E.m1a}`, { max_score: 50 });
    ok(r.status === 400 && /already 60 \+ this 50/.test(r.body?.message) && r.body?.errors?.remaining === 40, 'raising the quiz to 50 next to the 60-point final -> 400 (40 left for it)', r.body?.message);
    r = await call(A, 'PUT', `/exam-schedule/${E.m1a}`, { max_score: 40, name: `Math quiz s1 ${tag} (renamed)` });
    ok(r.status === 200, 'the same max score again -> 200');
    await exam(G.math, 'Base', 40, 1, next);
    const both = await Promise.all([exam(G.math, 'Race A', 60, 1, next), exam(G.math, 'Race B', 60, 1, next)]);
    ok(both.map((x) => x.status).sort().join() === '201,400', 'two 60-point exams at once on 40 used: one 201, one 400', both.map((x) => x.status).join());
    ok((await pool.query("SELECT SUM(max_score)::int n FROM exams WHERE class_id = $1 AND subject_id = $2 AND semester = 'semester1'", [next, G.math])).rows[0].n === 100, '10A math semester 1 totals exactly 100');

    console.log('== G1: one exam with its scores');
    r = await call(A, 'GET', `/grades/exams/${E.m1a}`);
    ok(r.status === 200 && r.body.data.grades.length === 5 && r.body.data.exam.semester === 'semester1' && !('grade_letter' in r.body.data.exam), 'admin: exam + 5 scores');
    ok((await call(TA, 'GET', `/grades/exams/${E.m1a}`)).status === 200, 'teacher A (math, 9A) -> 200');
    ok((await call(TA, 'GET', `/grades/exams/${E.e1a}`)).status === 403, 'teacher A, English exam -> 403');
    ok((await call(TB, 'GET', `/grades/exams/${E.m1a}`)).status === 403, 'teacher B -> 403');
    ok((await call(P, 'GET', `/grades/exams/${E.m1a}`)).status === 200, 'principal reads');
    ok((await call(A, 'GET', '/grades/exams/not-a-uuid')).status === 404, 'malformed id -> 404');

    console.log('== Scoping and bad input');
    ok((await call(TA, 'GET', `/results/class/${cls}?semester=1`)).status === 200, 'teacher A: own class results');
    ok((await call(TB, 'GET', `/results/class/${cls}?semester=1`)).status === 403, 'teacher B: other class -> 403');
    ok((await call(P, 'GET', `/results/class/${cls}?semester=year`)).status === 200, 'principal: class results');
    ok((await call(A, 'GET', `/results/class/${cls}?semester=3`)).status === 400, 'semester=3 -> 400');
    ok((await call(PA, 'GET', `/results/student/${S.abe}`)).status === 403, "parent: someone else's child -> 403");
    ok((await call(A, 'GET', `/results/student/${S.abe}?academic_year_id=nope`)).status === 400, 'academic_year_id malformed -> 400');
    ok((await call(A, 'GET', '/results/student/00000000-0000-4000-8000-000000000000')).status === 404, 'unknown student -> 404');

    console.log('== Analytics score bands');
    r = await call(A, 'GET', '/analytics/grades');
    ok(r.status === 200 && r.body.data.score_bands.semester1.map((b) => b.band).join() === '90-100,80-89,70-79,60-69,50-59,below-50' && !('grade_dist' in r.body.data), 'score bands per semester (D18); no letters list (M10)');

    for (const id of Object.values(S)) await call(A, 'DELETE', `/students/${id}`);
  } finally {
    await setting('manual_promotion_grades', []);
    await setting('pass_yearly_average', 50);
    await call(A, 'DELETE', `/teachers/${G.tA.tid}/classes/${cls}/${G.math}`);
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
