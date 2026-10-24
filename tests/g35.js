// Phase 2 M7: the school dashboard and the audit log viewer.
// GET /dashboard/school (admin, principal; teacher and parent 403): the current year only: counts,
// today's attendance per class (marked, partly marked, not marked, no students; rate), exams of the
// next 14 days with times, score bands per semester from the results, this year's fees. A year that
// contains today is made current while it runs (todayyear.js), 2024/2025 put back afterwards.
// GET /accounts/audit (admin only): filters by date range, user, action and target type, newest
// first, paging, readable labels (user name, target name in English and Amharic), the filter lists;
// bad dates, ids and limits 400. Scratch DB backend on :3100.
const pool = require('./tdb');
const { localDate, addDays, useTodayYear, restoreFixtureYear } = require('./todayyear');
const { legacyPayment, clearFees } = require('./fees');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const msg = (r) => `${r.status} ${r.body?.message ?? ''}`;
const tag = Date.now().toString(36).slice(-5).toUpperCase();

(async () => {
  console.log('[g35] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const pr = (await call(A, 'POST', '/accounts/principals', { email: `g35p${tag.toLowerCase()}@asms.et`, display_name: 'G35 Principal' })).body.data;
  const P0 = await login(`g35p${tag.toLowerCase()}@asms.et`, pr.temporary_password);
  const P = (await call(P0, 'POST', '/auth/change-password', { currentPassword: pr.temporary_password, newPassword: 'G35#pass2026' })).body.data.accessToken;
  const students = [], classes = [], exams = [];
  let subjectId = null;
  try {
    console.log('== School dashboard');
    const { year, today } = await useTodayYear(call, A);
    const before = (await call(A, 'GET', '/dashboard/school')).body.data;
    ok(before.academic_year?.id === year.id && before.attendance_today.date === today, `current year ${year.name}, today ${today}`, before.academic_year?.name);
    // Grade 3 A (3 students), B (1 student), C (none) in this year; free sections only
    const used = new Set((await pool.query('SELECT section FROM classes WHERE academic_year_id = $1 AND grade_level = 3', [year.id])).rows.map((r) => r.section));
    const sections = ['A', 'B', 'C', 'D', 'E'].filter((x) => !used.has(x));
    if (sections.length < 3) throw new Error('grade 3 of the today year is full; reset the scratch DB');
    for (const section of sections.slice(0, 3)) classes.push((await call(A, 'POST', '/classes', { academic_year_id: year.id, grade_level: 3, section })).body.data);
    const [cA, cB, cC] = classes;
    const stu = async (class_id, n) => { const id = (await call(A, 'POST', '/students', { first_name: `S${n}`, last_name: `G35${tag}`, gender: 'male', class_id })).body.data.id; students.push(id); return id; };
    const a1 = await stu(cA.id, 1), a2 = await stu(cA.id, 2), a3 = await stu(cA.id, 3), b1 = await stu(cB.id, 4);
    // Today's attendance straight into the table (today may be a weekend)
    await pool.query(`INSERT INTO attendance (student_id, class_id, date, status) VALUES
      ($1, $4, CURRENT_DATE, 'present'), ($2, $4, CURRENT_DATE, 'late'), ($3, $4, CURRENT_DATE, 'excused')`, [a1, a2, a3, cA.id]);
    let d = (await call(A, 'GET', '/dashboard/school')).body.data;
    const row = (c) => d.attendance_today.classes.find((x) => x.class_id === c.id);
    ok(row(cA)?.status === 'marked' && row(cA).students === 3 && row(cA).present === 1 && row(cA).late === 1 && row(cA).excused === 1 && row(cA).rate === 100,
      `${cA.name}: marked, 1 present 1 late 1 excused, rate 100 (late attended, excused left out)`, JSON.stringify(row(cA)));
    ok(row(cB)?.status === 'not_marked' && row(cB).students === 1 && row(cB).rate === null, `${cB.name}: not marked`, row(cB)?.status);
    ok(row(cC)?.status === 'no_students', `${cC.name}: no students`, row(cC)?.status);
    ok(d.attendance_today.classes_not_marked === before.attendance_today.classes_not_marked + 1, 'one more class not marked');
    await pool.query("DELETE FROM attendance WHERE student_id = $1 AND date = CURRENT_DATE", [a3]);
    d = (await call(A, 'GET', '/dashboard/school')).body.data;
    ok(row(cA)?.status === 'partly_marked' && row(cA).marked === 2, `${cA.name}: 2 of 3 -> partly marked`, row(cA)?.status);
    ok(!d.attendance_today.classes.some((c) => c.class_id === G.c9A), "2024/2025's 9A is not listed (another year)");
    ok(d.counts.classes === before.counts.classes + 3 && d.counts.students === before.counts.students + 4, 'counts: 3 more classes, 4 more students');

    // Exams: in 3 days (with times) and in 20 days; the subject's points add up to 100 (semester 1 or 2 by date)
    subjectId = (await call(A, 'POST', '/subjects', { name: 'Science G35', code: `SCI-${tag.slice(-4)}` })).body.data.id;
    const exam = async (date, max, more = {}) => {
      const r = await call(A, 'POST', '/exam-schedule', { class_id: cA.id, subject_id: subjectId, name: `G35 ${date}`, exam_type: 'midterm', max_score: max, exam_date: date, ...more });
      if (r.body?.data?.id) exams.push(r.body.data.id); else console.log('    exam', date, msg(r));
      return r.body?.data;
    };
    const inYear = (iso) => iso <= String(year.end_date).slice(0, 10);
    const soon = addDays(today, 3), late = addDays(today, 20);
    const e1 = inYear(soon) ? await exam(soon, 60, { start_time: '09:00', end_time: '10:30', room: 'Hall' }) : null;
    if (inYear(late)) await exam(late, 40);
    d = (await call(A, 'GET', '/dashboard/school')).body.data;
    const up = d.upcoming_exams.exams.filter((e) => e.class_id === cA.id);
    ok(d.upcoming_exams.days === 14 && up.length === 1 && up[0].exam_date === soon && up[0].start_time === '09:00' && up[0].room === 'Hall' && up[0].days_until === 3 && up[0].subject_name === 'Science G35',
      'upcoming: the exam in 3 days with its time and room; the one in 20 days left out', JSON.stringify(up.map((e) => e.exam_date)));

    // Results: Science scores 95 (1 student) and 55 (1 student); the third student has none
    const key = e1?.semester ?? 'semester1';   // the exam date decides
    const grade = async (examId, rows) => call(A, 'POST', '/grades', { exam_id: examId, grades: rows });
    const examsSem = (await pool.query('SELECT id, max_score FROM exams WHERE class_id = $1 AND subject_id = $2 AND semester = $3', [cA.id, subjectId, key])).rows;
    if (examsSem.length === 2) {
      const [x60, x40] = examsSem[0].max_score == 60 ? examsSem : [examsSem[1], examsSem[0]];
      await grade(x60.id, [{ student_id: a1, score: 57 }, { student_id: a2, score: 30 }]);
      await grade(x40.id, [{ student_id: a1, score: 38 }, { student_id: a2, score: 25 }]);
    }
    const bandsBefore = Object.fromEntries(before.results[key].bands.map((b) => [b.band, b.count]));
    d = (await call(A, 'GET', '/dashboard/school')).body.data;
    const bands = Object.fromEntries(d.results[key].bands.map((b) => [b.band, b.count]));
    ok(examsSem.length === 2 && bands['90-100'] === bandsBefore['90-100'] + 1 && bands['50-59'] === bandsBefore['50-59'] + 1
      && d.results[key].bands.map((b) => b.band).join() === '90-100,80-89,70-79,60-69,50-59,below-50',
      `${key}: one more 90-100 (95) and one more 50-59 (55); six bands in order`, JSON.stringify(bands));
    ok(Array.isArray(d.results.semester1?.bands) && Array.isArray(d.results.semester2?.bands), 'bands for both semesters');

    // Fees: this year's charges only (legacy term charges, as migrated by 024)
    await legacyPayment(pool, { student_id: a1, academic_year_id: year.id, due: 1000, paid: 400 });
    await legacyPayment(pool, { student_id: b1, academic_year_id: year.id, due: 500, paid: 600 });
    const fy = (await pool.query("SELECT id FROM academic_years WHERE name = '2024/2025'")).rows[0].id;
    await legacyPayment(pool, { student_id: a2, academic_year_id: fy, due: 9999, paid: 0 });
    d = (await call(A, 'GET', '/dashboard/school')).body.data;
    const f = d.fees, f0 = before.fees;
    ok(f.expected === f0.expected + 1500 && f.collected === f0.collected + 1000 && f.outstanding === f0.outstanding + 600 && f.credit === f0.credit + 100 && f.students_owing === f0.students_owing + 1,
      "fees: this year's 1500 due, 1000 paid, 600 outstanding, 100 credit, 1 owing; last year's 9999 not counted", JSON.stringify(f));

    console.log('== Roles');
    const pd = await call(P, 'GET', '/dashboard/school');
    ok(pd.status === 200 && pd.body.data.fees.expected === f.expected, 'principal: 200 with the fees');
    ok((await call(TA, 'GET', '/dashboard/school')).status === 403, 'teacher -> 403');

    console.log('== Audit log');
    await restoreFixtureYear(call, A);
    const au = (q) => call(A, 'GET', `/accounts/audit${q}`);
    const day = localDate();
    let r = await au(`?action=subject.created&from=${day}&to=${day}&limit=200`);
    let e = r.body?.data?.entries.find((x) => x.target_id === subjectId);
    ok(r.status === 200 && !!e && e.user_email === 'admin@asms.et' && e.target_label === 'Science G35' && e.target_type === 'subject' && r.body.data.entries.every((x) => x.action === 'subject.created'),
      "today's subject.created: our entry, by admin, target 'Science G35'", msg(r));
    await call(A, 'PUT', `/subjects/${subjectId}`, { name_am: 'ሳይንስ' });
    r = await au(`?target_type=subject&action=subject.created&from=${day}&to=${day}&limit=200`);
    e = r.body.data.entries.find((x) => x.target_id === subjectId);
    ok(e?.target_label_am === 'ሳይንስ', 'the Amharic label of the subject');
    r = await au(`?target_type=student&action=student.created&from=${day}&limit=200`);
    e = r.body.data.entries.find((x) => x.target_id === a1);
    ok(e?.target_label === `S1 G35${tag}`, "a student's entry labelled with the student's name", e?.target_label);
    r = await au(`?target_type=class&action=class.created&from=${day}&limit=200`);
    e = r.body.data.entries.find((x) => x.target_id === cA.id);
    ok(e?.target_label === `${cA.name} (${year.name})`, 'a class labelled with its name and year', e?.target_label);
    const admin = (await pool.query("SELECT id FROM users WHERE email = 'admin@asms.et'")).rows[0].id;
    r = await au(`?user_id=${admin}&limit=20`);
    ok(r.status === 200 && r.body.data.entries.length === 20 && r.body.data.entries.every((x) => x.user_id === admin), 'user_id: only that user', msg(r));
    const times = r.body.data.entries.map((x) => x.created_at);
    ok(times.every((t, i) => i === 0 || t <= times[i - 1]), 'newest first');
    const p1 = (await au('?limit=2&page=1')).body.data, p2 = (await au('?limit=2&page=2')).body.data;
    ok(p1.entries.length === 2 && p2.entries.length === 2 && p1.entries[1].id !== p2.entries[0].id && p1.pagination.total === p2.pagination.total && p1.pagination.totalPages === Math.ceil(p1.pagination.total / 2),
      'paging: page 2 continues page 1, same total');
    ok((await au('?')).body.data.pagination.limit === 50, '50 per page by default');
    r = await au(`?from=${addDays(day, 1)}`);
    ok(r.status === 200 && r.body.data.pagination.total === 0, 'from tomorrow: nothing', msg(r));
    r = await au(`?to=2000-01-01`);
    ok(r.status === 200 && r.body.data.pagination.total === 0, 'to 2000-01-01: nothing');
    const fl = r.body.data.filters;
    ok(fl.actions.some((x) => x.action === 'subject.created' && x.count > 0) && fl.target_types.some((x) => x.target_type === 'subject') && fl.users.some((x) => x.id === admin && x.email === 'admin@asms.et'),
      'filter lists: actions with counts, target types, users (whole log, not the filtered page)');
    for (const [q, what] of [['?from=2025-02-30', 'from 2025-02-30'], ['?to=yesterday', 'to "yesterday"'], [`?from=${day}&to=2000-01-01`, 'to before from'],
      ['?user_id=nope', 'malformed user_id'], ['?limit=201', 'limit 201'], ['?page=0', 'page 0']]) {
      ok((await au(q)).status === 400, `${what} -> 400`);
    }
    ok((await call(P, 'GET', '/accounts/audit')).status === 403 && (await call(TA, 'GET', '/accounts/audit')).status === 403, 'principal and teacher -> 403');
  } finally {
    await restoreFixtureYear(call, A);
    await clearFees(pool, students);
    await pool.query('DELETE FROM attendance WHERE student_id = ANY($1::uuid[])', [students]);
    await pool.query('DELETE FROM grades WHERE exam_id = ANY($1::uuid[])', [exams]);
    await pool.query('DELETE FROM exams WHERE id = ANY($1::uuid[])', [exams]);
    if (subjectId) await pool.query('DELETE FROM subjects WHERE id = $1', [subjectId]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [students]);
    await pool.query('DELETE FROM classes WHERE id = ANY($1::uuid[])', [classes.map((c) => c.id)]);
    const left = (await pool.query('SELECT COUNT(*)::int n FROM classes WHERE id = ANY($1::uuid[])', [classes.map((c) => c.id)])).rows[0].n;
    ok(left === 0, 'test classes, students, exams and payments removed', String(left));
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
