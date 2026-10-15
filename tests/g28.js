// Phase 2 M5a (C): conduct entered by the homeroom teacher (D23), manual promotion decisions
// (D26), semester locks (D29): every write of a locked semester refused with 409 (scores,
// exams create/edit/cancel, conduct, promotion decisions, attendance in its dates, a changed
// semester 2 start), unlock audited and writes working again; the promotion preview (M7a)
// with the yearly results (not promoted -> suggested repeat; incomplete / pending warnings).
// Scratch DB backend on :3100.
const pool = require('./tdb');
const { createFreeYear } = require('./years');
const { useTodayYear, restoreFixtureYear, localDate } = require('./todayyear');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const tag = Date.now().toString(36);
const audited = async (action) => (await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action = $1 AND created_at > NOW() - INTERVAL '2 minutes'", [action])).rows[0].n;

(async () => {
  console.log('[g28] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const TB = await login(G.tB.email, 'Pass#2026');
  const PA = await login(G.parent.email, 'Pass#2026');
  const setting = (key, value) => call(A, 'PUT', `/settings/${key}`, { value });
  const locks = [];

  // Fixtures: a test year, 9A with teacher A as homeroom (no subject in it) and teacher B teaching English
  const yr = (await createFreeYear(call, A, 6000, 7000)).body.data;
  const cls = (await call(A, 'POST', '/classes', { academic_year_id: yr.id, grade_level: 9, section: 'A', homeroom_teacher_id: G.tA.tid })).body.data.id;
  await call(A, 'POST', `/teachers/${G.tB.tid}/classes`, { class_id: cls, subject_id: G.eng });
  try {
    const stu = async (first) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G28${tag}`, gender: 'male', class_id: cls })).body.data.id;
    const S = { top: await stu('Top'), low: await stu('Low'), part: await stu('Part') };
    const exam = (sem, name = 'Math', max = 100) => call(A, 'POST', '/grades/exams', { class_id: cls, subject_id: G.math, name: `${name} ${tag}`, exam_type: 'final', max_score: max, semester: sem });
    const m1 = (await exam(1)).body.data.id, m2 = (await exam(2)).body.data.id;
    await call(A, 'POST', '/grades', { exam_id: m1, grades: [{ student_id: S.top, score: 90 }, { student_id: S.low, score: 40 }, { student_id: S.part, score: 70 }] });
    await call(A, 'POST', '/grades', { exam_id: m2, grades: [{ student_id: S.top, score: 90 }, { student_id: S.low, score: 40 }] });

    console.log('== Conduct (homeroom teacher and admin)');
    const conduct = (tok, sem, entries) => call(tok, 'PUT', `/results/class/${cls}/conduct`, { semester: sem, entries });
    let r = await conduct(TA, 1, [{ student_id: S.top, conduct: 'A', remark: 'ጎበዝ ተማሪ' }, { student_id: S.low, conduct: 'C', remark: 'Needs to focus' }]);
    ok(r.status === 200 && r.body.data.saved === 2, 'homeroom teacher A (no subject in the class) enters conduct -> 200', `${r.status} ${r.body?.message}`);
    ok((await conduct(TB, 1, [{ student_id: S.top, conduct: 'B' }])).status === 403, 'teacher B (teaches the class, not homeroom) -> 403');
    ok((await conduct(P, 1, [{ student_id: S.top, conduct: 'B' }])).status === 403, 'principal -> 403');
    ok((await conduct(A, 1, [{ student_id: S.part, conduct: 'B' }])).status === 200, 'admin -> 200');
    ok((await conduct(A, 1, [{ student_id: S.top, conduct: 'E' }])).status === 400, 'conduct E -> 400');
    ok((await conduct(A, 1, [{ student_id: S.top, conduct: 'A', remark: 'x'.repeat(301) }])).status === 400, 'remark of 301 characters -> 400');
    ok((await conduct(A, 1, [{ student_id: S.top, conduct: 'A' }, { student_id: S.top, conduct: 'B' }])).status === 400, 'the same student twice -> 400');
    ok((await conduct(A, 3, [{ student_id: S.top, conduct: 'A' }])).status === 400, 'semester 3 -> 400');
    ok((await conduct(A, 1, [{ student_id: G.s1.sid, conduct: 'A' }])).status === 403, 'a student of another class -> 403');
    ok((await call(TA, 'GET', `/results/class/${cls}/conduct?semester=1`)).status === 200, 'homeroom teacher reads conduct');
    ok((await call(TB, 'GET', `/results/class/${cls}/conduct?semester=1`)).status === 200, 'teacher of the class reads conduct');
    ok((await call(PA, 'GET', `/results/class/${cls}/conduct?semester=1`)).status === 403, 'parent -> 403');
    ok(await audited('results.conduct_saved') >= 2, 'conduct saves audited');
    r = await call(A, 'GET', `/results/student/${S.top}?academic_year_id=${yr.id}`);
    ok(r.body?.data?.semesters?.semester1?.conduct === 'A' && r.body.data.semesters.semester1.remark === 'ጎበዝ ተማሪ', 'the results carry conduct and the Amharic remark');
    await conduct(A, 1, [{ student_id: S.part, conduct: null }]);
    ok((await pool.query("SELECT COUNT(*)::int n FROM semester_conduct WHERE student_id = $1", [S.part])).rows[0].n === 0, 'conduct null clears it');

    console.log('== Manual promotion decisions');
    const result = async (k) => (await call(A, 'GET', `/results/student/${S[k]}?academic_year_id=${yr.id}`)).body.data.year.promotion;
    ok((await result('top'))?.status === 'promoted' && (await result('low'))?.status === 'not_promoted' && (await result('part')) === null, 'pass mark 50: Top promoted, Low (40) not, Part incomplete (none)');
    await setting('manual_promotion_grades', [9]);
    ok((await result('top'))?.status === 'pending', 'grade 9 manual: "pending" until the admin decides');
    r = await call(A, 'PUT', `/results/student/${S.top}/promotion`, { academic_year_id: yr.id, promoted: true, note: 'National exam passed' });
    ok(r.status === 200 && (await result('top'))?.status === 'promoted' && (await result('top'))?.basis === 'decision', 'decision recorded: promoted (by decision)');
    r = await call(A, 'PUT', `/results/class/${cls}/promotion`, { decisions: [{ student_id: S.low, promoted: false }, { student_id: S.top, promoted: null }] });
    ok(r.status === 200 && (await result('low'))?.status === 'not_promoted' && (await result('top'))?.status === 'pending', 'class form: Low not promoted, Top cleared back to pending');
    await setting('manual_promotion_grades', []);
    await call(A, 'PUT', `/results/student/${S.top}/promotion`, { academic_year_id: yr.id, promoted: false, note: 'Re-sit needed' });
    ok((await result('top'))?.status === 'not_promoted', 'a decision overrides the pass mark for other grades too');
    await call(A, 'PUT', `/results/student/${S.top}/promotion`, { academic_year_id: yr.id, promoted: null });
    ok((await call(TA, 'PUT', `/results/student/${S.top}/promotion`, { academic_year_id: yr.id, promoted: true })).status === 403, 'teacher -> 403');
    ok((await call(A, 'PUT', `/results/student/${S.top}/promotion`, { academic_year_id: yr.id, promoted: 'yes' })).status === 400, 'promoted "yes" -> 400');
    ok((await call(A, 'PUT', `/results/student/${S.top}/promotion`, { promoted: true })).status === 400, 'no academic_year_id -> 400');
    ok(await audited('results.promotion_decided') >= 4, 'decisions audited');

    console.log('== Promotion preview (M7a) with the results');
    let to = null;
    for (let y = Number(yr.name.slice(0, 4)) + 1; !to; y++) {
      const t = await call(A, 'POST', '/academic-years', { name: `${y}/${y + 1}`, start_date: `${y}-09-01`, end_date: `${y + 1}-07-31` });
      if (t.status === 201) to = t.body.data;
    }
    await call(A, 'POST', '/classes', { academic_year_id: to.id, grade_level: 10, section: 'A' });
    await call(A, 'POST', '/classes', { academic_year_id: to.id, grade_level: 9, section: 'A' });
    r = await call(A, 'POST', `/academic-years/${to.id}/promotion-preview`, { from_year_id: yr.id });
    const pv = r.body?.data;
    ok(r.status === 200 && JSON.stringify(pv.suggested_repeat) === JSON.stringify([S.low]), '"Not promoted" Low is suggested as repeating', JSON.stringify(pv?.suggested_repeat));
    ok(pv.warnings.incomplete === 1 && pv.warnings.pending === 0, 'warning: 1 incomplete (Part), not a block', JSON.stringify(pv.warnings));
    ok(pv.students.find((x) => x.student.id === S.top)?.result?.status === 'promoted' && pv.students.find((x) => x.student.id === S.top).action === 'promote', 'Top: promoted, still promoted (the admin decides with exclude)');
    await setting('manual_promotion_grades', [9]);
    r = await call(A, 'POST', `/academic-years/${to.id}/promotion-preview`, { from_year_id: yr.id });
    ok(r.body?.data?.warnings?.pending === 1, 'manual grade: Top pending (Low has a decision) -> 1 pending warning', JSON.stringify(r.body?.data?.warnings));
    await setting('manual_promotion_grades', []);

    console.log('== Locks');
    ok((await call(TA, 'POST', '/results/locks', { academic_year_id: yr.id, semester: 1, class_id: cls })).status === 403, 'teacher cannot lock');
    r = await call(A, 'POST', '/results/locks', { academic_year_id: yr.id, semester: 1, class_id: cls, reason: 'Report cards printed' });
    ok(r.status === 201 && await audited('results.semester_locked') >= 1, 'admin locks semester 1 of 9A (audited)');
    const lock1 = r.body?.data?.id; locks.push(lock1);
    ok((await call(A, 'POST', '/results/locks', { academic_year_id: yr.id, semester: 1, class_id: cls })).status === 409, 'locking it again -> 409');
    ok((await call(A, 'POST', '/results/locks', { academic_year_id: to.id, semester: 1, class_id: cls })).status === 400, 'a class of another year -> 400');
    ok((await call(P, 'GET', `/results/locks?academic_year_id=${yr.id}`)).body?.data?.length === 1, 'principal sees the lock');
    r = await call(A, 'POST', '/grades', { exam_id: m1, grades: [{ student_id: S.part, score: 71 }] });
    ok(r.status === 409 && /Semester 1 .* E\.C\. is locked for Grade 9 Section A/.test(r.body?.message), 'scores of a locked semester -> 409 naming the lock', r.body?.message);
    ok((await exam(1, 'New', 1)).status === 409, 'new exam in the locked semester -> 409');
    ok((await call(A, 'PUT', `/exam-schedule/${m1}`, { name: 'Renamed' })).status === 409, 'editing its exam -> 409');
    const sem2Extra = (await call(A, 'POST', '/grades/exams', { class_id: cls, subject_id: G.eng, name: `Spare ${tag}`, exam_type: 'quiz', max_score: 1, semester: 2 })).body?.data?.id;
    ok(!!sem2Extra, 'semester 2 is not locked: a new exam there -> 201');
    ok((await call(A, 'PUT', `/exam-schedule/${sem2Extra}`, { semester: 1 })).status === 409, 'moving an exam into the locked semester -> 409');
    ok((await conduct(A, 1, [{ student_id: S.top, conduct: 'B' }])).status === 409, 'conduct of the locked semester -> 409');
    ok((await conduct(A, 2, [{ student_id: S.top, conduct: 'B' }])).status === 200, 'conduct of semester 2 -> 200');
    r = await call(A, 'PUT', `/academic-years/${yr.id}`, { semester2_start: (() => { const d = new Date(`${yr.semester2_start}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })() });
    ok(r.status === 409, 'changing semester 2 start while a semester is locked -> 409', r.body?.message);
    r = await call(A, 'GET', `/results/student/${S.top}?academic_year_id=${yr.id}`);
    ok(r.body?.data?.semesters?.semester1?.final === true && r.body.data.semesters.semester2.final === false, 'semester 1 "final", semester 2 "provisional"');
    // An attendance record dated in the locked semester (inserted directly: the test year is in the future)
    const d1 = (() => { const d = new Date(`${yr.start_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 20); return d.toISOString().slice(0, 10); })();
    const att = (await pool.query("INSERT INTO attendance (student_id, class_id, date, status) VALUES ($1, $2, $3, 'absent') RETURNING id", [S.top, cls, d1])).rows[0].id;
    r = await call(A, 'PUT', `/attendance/${att}`, { status: 'excused', reason: 'Letter' });
    ok(r.status === 409 && /locked/.test(r.body?.message), 'attendance correction inside the locked semester -> 409', r.body?.message);

    console.log('== Whole-school lock and promotion decisions');
    r = await call(A, 'POST', '/results/locks', { academic_year_id: yr.id, semester: 2 });
    const lock2 = r.body?.data?.id; locks.push(lock2);
    ok(r.status === 201, 'whole-school lock of semester 2');
    r = await call(A, 'PUT', `/results/student/${S.low}/promotion`, { academic_year_id: yr.id, promoted: true });
    ok(r.status === 409 && /whole school/.test(r.body?.message), 'promotion decision while semester 2 is locked -> 409 (whole school)', r.body?.message);
    ok((await call(A, 'POST', '/grades', { exam_id: m2, grades: [{ student_id: S.part, score: 50 }] })).status === 409, 'scores of semester 2 -> 409');

    console.log('== Unlock');
    ok((await call(TA, 'DELETE', `/results/locks/${lock1}`)).status === 403, 'teacher cannot unlock');
    r = await call(A, 'DELETE', `/results/locks/${lock1}`, { reason: 'Correction of a score' });
    const ul = (await pool.query("SELECT new_data FROM audit_logs WHERE action = 'results.semester_unlocked' AND target_id = $1", [lock1])).rows[0]?.new_data;
    ok(r.status === 200 && ul?.reason === 'Correction of a score', 'unlock audited with the reason');
    await call(A, 'DELETE', `/results/locks/${lock2}`);
    locks.length = 0;
    ok((await call(A, 'POST', '/grades', { exam_id: m1, grades: [{ student_id: S.part, score: 71 }] })).status === 200, 'after unlocking: scores work again');
    ok((await call(A, 'PUT', `/attendance/${att}`, { status: 'excused', reason: 'Letter' })).status === 200, 'after unlocking: attendance correction works again');
    ok((await call(A, 'DELETE', '/results/locks/00000000-0000-4000-8000-000000000000')).status === 404, 'unknown lock -> 404');

    console.log('== Attendance marking in a locked semester (a year around today)');
    const { year: now } = await useTodayYear(call, A);
    try {
      const list = (await call(A, 'GET', `/classes?academic_year_id=${now.id}`)).body.data;
      const c2 = list.find((c) => c.grade_level === 4 && c.section === 'E')?.id
        ?? (await call(A, 'POST', '/classes', { academic_year_id: now.id, grade_level: 4, section: 'E' })).body.data.id;
      const kid = (await call(A, 'POST', '/students', { first_name: 'Kid', last_name: `G28${tag}`, gender: 'male', class_id: c2 })).body.data.id;
      const today = localDate();
      const sem = today >= now.semester2_start ? 2 : 1;
      const l3 = (await call(A, 'POST', '/results/locks', { academic_year_id: now.id, semester: sem, class_id: c2 })).body?.data?.id;
      r = await call(A, 'POST', '/attendance', { class_id: c2, date: today, records: [{ student_id: kid, status: 'present' }] });
      ok(r.status === 409 && /locked/.test(r.body?.message), 'marking today inside a locked semester -> 409', r.body?.message);
      await call(A, 'DELETE', `/results/locks/${l3}`);
      ok((await call(A, 'POST', '/attendance', { class_id: c2, date: today, records: [{ student_id: kid, status: 'present' }] })).status === 201, 'after unlocking -> 201');
      await call(A, 'DELETE', `/students/${kid}`);
    } finally {
      await restoreFixtureYear(call, A);
    }

    for (const id of Object.values(S)) await call(A, 'DELETE', `/students/${id}`);
  } finally {
    for (const id of locks) await call(A, 'DELETE', `/results/locks/${id}`);
    await setting('manual_promotion_grades', []);
    await call(A, 'DELETE', `/teachers/${G.tB.tid}/classes/${cls}/${G.eng}`);
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
