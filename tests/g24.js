// Phase 2 M4 (A): attendance marking rules, class sheet, admin correction, rate rule.
//   - never 500: bad dates, statuses, records, notes, duplicates -> 400
//   - no future dates; the date inside the class's year; teacher: own classes of the current
//     year, today and the previous 3 days; admin: any past date of the year, audited outside
//     the teacher window; re-marking updates the one record per student per day
//   - correction: admin only, reason required, audited (old/new); note can be cleared
//   - rate = (present + late) / (marked - excused), also in the report card
// The scratch fixtures' year (2024/2025) is in the past, so a test year containing today is
// made current while this runs and 2024/2025 is put back at the end (tests/todayyear.js).
// Scratch DB backend on :3100.
const pool = require('./tdb');
const { localDate, addDays, useTodayYear, restoreFixtureYear } = require('./todayyear');
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
  console.log('[g24] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const TB = await login(G.tB.email, 'Pass#2026');
  try {
    const { year, today } = await useTodayYear(call, A);
    const old = (await call(A, 'GET', '/academic-years')).body.data.find((y) => y.name === '2024/2025');
    console.log(`  (current year for this run: ${year.name}, today ${today})`);

    // g24's own classes, reused by every run: 7E in the current test year (teacher A), 7E in
    // 2024/2025 (a past year), and 7D (always empty). Earlier runs' students and their
    // attendance are cleared first, so each run starts with empty classes.
    await pool.query("DELETE FROM attendance WHERE student_id IN (SELECT id FROM students WHERE last_name LIKE 'G24%')");
    await pool.query("UPDATE students SET class_id = NULL WHERE last_name LIKE 'G24%'");
    const classIn = async (yearId, section) => {
      const list = (await call(A, 'GET', `/classes?academic_year_id=${yearId}`)).body.data;
      return list.find((c) => c.grade_level === 7 && c.section === section)?.id
        ?? (await call(A, 'POST', '/classes', { academic_year_id: yearId, grade_level: 7, section })).body.data.id;
    };
    const cls = await classIn(year.id, 'E');
    const pastCls = await classIn(old.id, 'E');
    const emptyCls = await classIn(year.id, 'D');
    await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: cls, subject_id: G.math });
    const stu = async (first, class_id, more = {}) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G24${tag}`, gender: 'female', class_id, ...more })).body.data.id;
    const sa = await stu('Abeba', cls, { fathers_name: 'Kebede', first_name_am: 'አበባ', fathers_name_am: 'ከበደ' });
    const sb = await stu('Bethel', cls);
    const sp = await stu('Hana', pastCls);
    const mark = (tok, class_id, date, records) => call(tok, 'POST', '/attendance', { class_id, date, records });
    const one = (id, status = 'present', note) => [{ student_id: id, status, ...(note !== undefined ? { note } : {}) }];
    const d = (n) => addDays(today, -n);
    const inYear = (iso) => iso >= year.start_date && iso <= year.end_date;

    console.log('== Bad input -> 400 (never 500)');
    for (const [label, body] of [
      ['impossible date 2026-02-30', { class_id: cls, date: '2026-02-30', records: one(sa) }],
      ['date "yesterday"', { class_id: cls, date: 'yesterday', records: one(sa) }],
      ['records not an array', { class_id: cls, date: today, records: 'x' }],
      ['records empty', { class_id: cls, date: today, records: [] }],
      ['a record that is null', { class_id: cls, date: today, records: [null] }],
      ['a record that is a string', { class_id: cls, date: today, records: ['x'] }],
      ['status "sick"', { class_id: cls, date: today, records: one(sa, 'sick') }],
      ['note is a number', { class_id: cls, date: today, records: one(sa, 'late', 5) }],
      ['note of 501 characters', { class_id: cls, date: today, records: one(sa, 'late', 'x'.repeat(501)) }],
      ['the same student twice', { class_id: cls, date: today, records: [...one(sa), ...one(sa, 'absent')] }],
      ['class_id missing', { date: today, records: one(sa) }],
      ['class_id malformed', { class_id: 'nope', date: today, records: one(sa) }],
    ]) {
      const r = await call(A, 'POST', '/attendance', body);
      ok(r.status === 400, `${label} -> 400`, `got ${r.status} ${r.body?.message}`);
    }

    console.log('== Dates and roles');
    let r = await mark(A, cls, addDays(today, 1), one(sa));
    ok(r.status === 400 && r.body?.errors?.code === 'future', 'tomorrow -> 400 future (admin too)', r.body?.message);
    r = await mark(A, cls, addDays(year.start_date, -1), one(sa));
    ok(r.status === 400 && r.body?.errors?.code === 'outside_year', 'day before the year starts -> 400 outside_year', r.body?.message);
    r = await mark(TA, cls, today, [...one(sa), ...one(sb, 'absent')]);
    ok(r.status === 201 && r.body.data.summary.present === 1 && r.body.data.summary.absent === 1, 'teacher A marks own class today -> 201');
    r = await mark(TA, cls, today, one(sb, 'late', 'bus'));
    const rows = (await pool.query('SELECT status, note FROM attendance WHERE student_id = $1 AND date = $2', [sb, today])).rows;
    ok(r.status === 201 && rows.length === 1 && rows[0].status === 'late' && rows[0].note === 'bus', 're-marking the same day updates the one record');
    if (inYear(d(3))) {
      r = await mark(TA, cls, d(3), one(sa, 'excused'));
      ok(r.status === 201, 'teacher: 3 days ago -> 201', `got ${r.status} ${r.body?.message}`);
    }
    if (inYear(d(4))) {
      r = await mark(TA, cls, d(4), one(sa));
      ok(r.status === 403 && r.body?.errors?.code === 'too_old', 'teacher: 4 days ago -> 403 too_old', r.body?.message);
      const before = (await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action = 'attendance.marked_past' AND target_id = $1", [cls])).rows[0].n;
      r = await mark(A, cls, d(4), one(sa));
      const after = (await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action = 'attendance.marked_past' AND target_id = $1", [cls])).rows[0].n;
      ok(r.status === 201 && after === before + 1, 'admin: 4 days ago -> 201, audited (attendance.marked_past)');
      await mark(A, cls, today, one(sa));
      const again = (await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE action = 'attendance.marked_past' AND target_id = $1", [cls])).rows[0].n;
      ok(again === after, 'admin marking today is not audited as a past day');
    }
    await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: pastCls, subject_id: G.math });
    r = await mark(TA, pastCls, '2025-03-03', one(sp));
    ok(r.status === 403 && r.body?.errors?.code === 'not_current_year', "teacher: own class of a past year -> 403 not_current_year", r.body?.message);
    r = await mark(A, pastCls, '2025-03-03', one(sp, 'absent'));
    ok(r.status === 201, 'admin: a past year, inside its dates -> 201', `got ${r.status} ${r.body?.message}`);
    ok((await mark(TB, cls, today, one(sa))).status === 403, 'teacher B (not assigned) -> 403');
    ok((await mark(P, cls, today, one(sa))).status === 403, 'principal cannot mark -> 403');
    r = await mark(A, cls, today, one(sp));
    ok(r.status === 403 && r.body?.errors?.student_ids?.[0] === sp, 'admin: a student of another class -> 403 with the ids');

    console.log('== Class sheet');
    ok((await call(A, 'GET', `/attendance/${cls}/2026-13-01`)).status === 400, 'sheet: month 13 -> 400');
    ok((await call(A, 'GET', `/attendance/${cls}/today`)).status === 400, 'sheet: "today" -> 400');
    r = await call(TA, 'GET', `/attendance/${cls}/${today}`);
    const rowA = r.body?.data?.students?.find((s) => s.student_id === sa);
    ok(r.status === 200 && r.body.data.marking.allowed === true && r.body.data.summary.total === 2, 'teacher: own class today, may mark, 2 students');
    ok(rowA?.first_name_am === 'አበባ' && rowA?.fathers_name_am === 'ከበደ' && rowA?.fathers_name === 'Kebede', 'sheet has the Amharic and father\'s names');
    if (inYear(d(4))) {
      r = await call(TA, 'GET', `/attendance/${cls}/${d(4)}`);
      ok(r.status === 200 && r.body.data.marking.allowed === false && r.body.data.marking.code === 'too_old', 'teacher: 4 days ago readable, not markable (too_old)');
    }
    r = await call(P, 'GET', `/attendance/${cls}/${today}`);
    ok(r.status === 200 && r.body.data.marking.code === 'role', 'principal: reads the sheet, cannot mark');
    ok((await call(TB, 'GET', `/attendance/${cls}/${today}`)).status === 403, 'teacher B: sheet -> 403');
    r = await call(A, 'GET', `/attendance/${emptyCls}/${today}`);
    ok(r.status === 200 && r.body.data.summary.total === 0, 'empty class -> 200 with no students (was 404)');

    console.log('== Correction (admin, reason, audited)');
    const recId = (await pool.query('SELECT id FROM attendance WHERE student_id = $1 AND date = $2', [sb, today])).rows[0].id;
    const put = (tok, body, id = recId) => call(tok, 'PUT', `/attendance/${id}`, body);
    ok((await put(A, { status: 'absent' })).status === 400, 'no reason -> 400');
    ok((await put(A, { status: 'absent', reason: '   ' })).status === 400, 'blank reason -> 400');
    ok((await put(A, { status: 'gone', reason: 'x' })).status === 400, 'bad status -> 400');
    ok((await put(A, { reason: 'x' })).status === 400, 'nothing to change -> 400');
    ok((await put(A, { note: 7, reason: 'x' })).status === 400, 'note a number -> 400');
    ok((await put(TA, { status: 'absent', reason: 'x' })).status === 403, 'teacher -> 403');
    ok((await put(P, { status: 'absent', reason: 'x' })).status === 403, 'principal -> 403');
    ok((await put(A, { status: 'absent', reason: 'x' }, 'not-a-uuid')).status === 404, 'malformed id -> 404');
    ok((await put(A, { status: 'absent', reason: 'x' }, '00000000-0000-4000-8000-000000000000')).status === 404, 'unknown id -> 404');
    r = await put(A, { status: 'excused', note: null, reason: 'Doctor\'s letter brought in' });
    ok(r.status === 200 && r.body.data.status === 'excused' && r.body.data.note === null, 'admin corrects late -> excused and clears the note');
    const log = (await pool.query("SELECT new_data FROM audit_logs WHERE action = 'attendance.corrected' AND target_id = $1 ORDER BY created_at DESC LIMIT 1", [recId])).rows[0]?.new_data;
    ok(log?.old?.status === 'late' && log?.old?.note === 'bus' && log?.new?.status === 'excused' && log?.reason === 'Doctor\'s letter brought in', 'audit entry with old, new and the reason');

    console.log('== Student history and the rate rule');
    ok((await call(A, 'GET', `/attendance/student/${sa}?month=13&year=2026`)).status === 400, 'month 13 -> 400');
    ok((await call(A, 'GET', `/attendance/student/${sa}?month=5`)).status === 400, 'month without a year -> 400');
    ok((await call(A, 'GET', `/attendance/student/${sa}?year=20x6`)).status === 400, 'year "20x6" -> 400');
    // sb: today excused (after the correction); make 3 more days: present, late, absent
    const days = [d(1), d(2), d(3)].filter(inYear);
    if (days.length === 3) {
      await mark(TA, cls, days[0], one(sb, 'present'));
      await mark(TA, cls, days[1], one(sb, 'late'));
      await mark(TA, cls, days[2], one(sb, 'absent'));
      r = await call(A, 'GET', `/attendance/student/${sb}`);
      const st = r.body?.data?.stats;
      ok(r.status === 200 && Number(st.total_days) === 4 && Number(st.absent) === 1 && Number(st.excused) === 1, 'history: 4 days, 1 absent, 1 excused', JSON.stringify(st));
      ok(Number(st.attendance_rate) === 66.7, 'rate = (present + late) / (marked - excused) = 2/3 = 66.7', st.attendance_rate);
      r = await call(A, 'GET', `/grades/report-card/${sb}`);
      ok(r.status === 200 && Number(r.body.data.attendance.rate) === 66.7, 'report card uses the same rate', r.body?.data?.attendance?.rate);
    }
    for (const p of ['/analytics/overview', '/analytics/attendance']) {
      ok((await call(A, 'GET', p)).status === 200, `${p} -> 200 with the new rate`);
    }

    for (const id of [sa, sb, sp]) await call(A, 'DELETE', `/students/${id}`);
  } finally {
    await restoreFixtureYear(call, A);
    const cur = (await pool.query('SELECT name FROM academic_years WHERE is_current')).rows[0]?.name;
    ok(cur === '2024/2025', 'fixtures year 2024/2025 is current again', cur);
  }

  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
