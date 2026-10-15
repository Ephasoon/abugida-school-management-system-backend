// Phase 2 M4 (B): attendance report for a date range (the app sends the Gregorian range of an
// Ethiopian month): students × days grid, totals, rate (D32); Monday–Friday plus a weekend
// day only when it has records (D31); students who moved keep their rows; the older
// month/year query still works; never 500 (bad dates, ranges, ids -> 400/404).
// Uses a test year containing today (tests/todayyear.js) and puts 2024/2025 back.
// Scratch DB backend on :3100.
const pool = require('./tdb');
const { addDays, useTodayYear, restoreFixtureYear } = require('./todayyear');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const tag = Date.now().toString(36);
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

(async () => {
  console.log('[g25] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const P = await login('principal.g7@asms.et', 'Pass#2026');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const TB = await login(G.tB.email, 'Pass#2026');
  try {
    const { year, today } = await useTodayYear(call, A);
    // g25's own classes (7C, 7B in the test year), emptied of earlier runs' students first
    await pool.query("DELETE FROM attendance WHERE student_id IN (SELECT id FROM students WHERE last_name LIKE 'G25%')");
    await pool.query("UPDATE students SET class_id = NULL WHERE last_name LIKE 'G25%'");
    const classIn = async (section) => {
      const list = (await call(A, 'GET', `/classes?academic_year_id=${year.id}`)).body.data;
      return list.find((c) => c.grade_level === 7 && c.section === section)?.id
        ?? (await call(A, 'POST', '/classes', { academic_year_id: year.id, grade_level: 7, section })).body.data.id;
    };
    const cls = await classIn('C');
    const other = await classIn('B');
    await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: cls, subject_id: G.math });
    const stu = async (first, more = {}) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G25${tag}`, gender: 'male', class_id: cls, ...more })).body.data.id;
    const sa = await stu('Abel', { first_name_am: 'አቤል' });
    const sb = await stu('Biruk');
    const sc = await stu('Caleb');
    const report = (tok, q, id = cls) => call(tok, 'GET', `/attendance/report/${id}${q}`);

    console.log('== Bad input');
    for (const [label, q, code] of [
      ['from without to', `?from=${today}`, 400],
      ['to before from', `?from=${today}&to=${addDays(today, -1)}`, 400],
      ['63 days', `?from=${addDays(today, -62)}&to=${today}`, 400],
      ['impossible date', '?from=2026-02-30&to=2026-03-05', 400],
      ['from "abc"', `?from=abc&to=${today}`, 400],
      ['month 13', '?month=13&year=2026', 400],
      ['year "20x6"', '?month=9&year=20x6', 400],
    ]) {
      const r = await report(A, q);
      ok(r.status === code, `${label} -> ${code}`, `got ${r.status} ${r.body?.message}`);
    }
    ok((await report(A, `?from=${addDays(today, -61)}&to=${today}`)).status === 200, '62 days -> 200');
    ok((await report(A, '', 'not-a-uuid')).status === 404, 'admin, malformed class id -> 404 (was 500)');
    ok((await report(A, '', '00000000-0000-4000-8000-000000000000')).status === 404, 'admin, unknown class -> 404');
    ok((await call(A, 'GET', `/attendance/not-a-uuid/${today}`)).status === 404, 'sheet: admin, malformed class id -> 404 (was 500)');

    console.log('== Access');
    ok((await report(TB, '')).status === 403, 'teacher B (not assigned) -> 403');
    ok((await report(TA, '')).status === 200, 'teacher A (own class) -> 200');
    ok((await report(P, '')).status === 200, 'principal -> 200');

    console.log('== Grid');
    // A Monday at least 6 days ago, so Monday..Saturday are all past, inside the test year
    let mon = addDays(today, -6);
    while (weekday(mon) !== 1) mon = addDays(mon, -1);
    const [tue, wed, thu, sat, sun] = [1, 2, 3, 5, 6].map((n) => addDays(mon, n));
    if (mon < year.start_date) {
      console.log('  (skipped: the test year started less than two weeks ago)');
    } else {
      const mark = (date, records) => call(A, 'POST', '/attendance', { class_id: cls, date, records });
      await mark(mon, [{ student_id: sa, status: 'present' }, { student_id: sb, status: 'present' }, { student_id: sc, status: 'present' }]);
      await mark(tue, [{ student_id: sa, status: 'late', note: 'bus' }]);
      await mark(wed, [{ student_id: sa, status: 'absent' }]);
      await mark(thu, [{ student_id: sa, status: 'excused' }]);
      await mark(sat, [{ student_id: sb, status: 'present' }]);
      await call(A, 'PUT', `/students/${sc}`, { class_id: other });   // Caleb moves after Monday

      const r = await report(A, `?from=${mon}&to=${sun}`);
      const data = r.body?.data;
      ok(r.status === 200 && data.from === mon && data.to === sun, 'range report -> 200 with from/to');
      ok(data.days.map((d) => d.date).join() === [mon, tue, wed, thu, addDays(mon, 4), sat].join(), 'days: Monday–Friday plus the Saturday with records, not the empty Sunday', data.days.map((d) => d.date).join());
      ok(data.days.find((d) => d.date === mon).marked === 3 && data.days.find((d) => d.date === addDays(mon, 4)).marked === 0, 'records counted per day');
      const row = (id) => data.students.find((s) => s.student_id === id);
      const a = row(sa);
      ok(a && a.total_days === 4 && a.present === 1 && a.late === 1 && a.absent === 1 && a.excused === 1, 'Abel: 4 days, 1 each', JSON.stringify(a && { t: a.total_days, p: a.present, l: a.late, ab: a.absent, e: a.excused }));
      ok(a.attendance_rate === 66.7, 'Abel: rate (1 + 1) / (4 - 1) = 66.7', a.attendance_rate);
      ok(a.records[tue]?.status === 'late' && a.records[tue]?.note === 'bus' && a.records[tue]?.id && !a.records[addDays(mon, 4)], 'records keyed by date, with id and note; none for the unmarked Friday');
      ok(a.first_name_am === 'አቤል', 'Amharic name in the report');
      ok(row(sb)?.attendance_rate === 100 && row(sb)?.total_days === 2, 'Biruk: 2 days, 100%');
      ok(row(sc)?.total_days === 1 && row(sc)?.records[mon]?.status === 'present', 'Caleb moved to another class: still listed with his record');
      ok(data.class_stats.total_students === 3 && data.class_stats.days_marked === 5 && data.class_stats.perfect_attendance === 2 && data.class_stats.below_75_percent === 1, 'class stats', JSON.stringify(data.class_stats));
      const later = await report(A, `?from=${addDays(sun, 1)}&to=${addDays(sun, 1)}`);
      ok(later.status === 200 && !later.body.data.students.some((s) => s.student_id === sc), 'Caleb is not listed for a range without his records');

      const legacy = await report(A, `?month=${Number(mon.slice(5, 7))}&year=${mon.slice(0, 4)}`);
      ok(legacy.status === 200 && legacy.body.data.from === `${mon.slice(0, 7)}-01` && legacy.body.data.month === Number(mon.slice(5, 7)), 'old month/year query -> that Gregorian month', `${legacy.body?.data?.from}..${legacy.body?.data?.to}`);
    }
    const def = await report(A, '');
    ok(def.status === 200 && def.body.data.from === `${today.slice(0, 7)}-01`, 'no query -> this month');

    for (const id of [sa, sb, sc]) await call(A, 'DELETE', `/students/${id}`);
    // Teacher A's classes are checked by g7 and g9: no assignment left behind
    for (const c of [cls]) await call(A, 'DELETE', `/teachers/${G.tA.tid}/classes/${c}/${G.math}`);
  } finally {
    await restoreFixtureYear(call, A);
    const cur = (await pool.query('SELECT name FROM academic_years WHERE is_current')).rows[0]?.name;
    ok(cur === '2024/2025', 'fixtures year 2024/2025 is current again', cur);
  }

  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
