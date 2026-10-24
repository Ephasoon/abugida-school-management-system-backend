// Phase 2 M6 backend: the parent portal's data and its scoping. /parent/children with Amharic
// names, class and year (archived children listed with their status); a student's attendance
// for a date range (an Ethiopian month spans two Gregorian months; at most 62 days); a parent
// gets 403 for another family's child or class on every endpoint the portal uses; no teacher
// phone or email in any of those responses. A child without a class: results 200 with an empty
// result (no 404), still 403 for another family and 404 for an unknown student. Scratch DB backend on :3100.
const pool = require('./tdb');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* a PDF */ }
  return { status: r.status, body: json, text };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const tag = Date.now().toString(36);

(async () => {
  console.log('[g32] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const year = (await call(A, 'GET', '/academic-years/current')).body.data;

  // Two families: Kidist (9A) and Kaleb (archived) for parent 1, Liya (9B) for parent 2
  const child = async (first, class_id, more = {}) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G32${tag}`, gender: 'female', class_id, ...more })).body.data.id;
  const kidist = await child('Kidist', G.c9A, { fathers_name: 'Alemu', first_name_am: 'ቅድስት', fathers_name_am: 'አለሙ', last_name_am: 'ገ32' });
  const kaleb = await child('Kaleb', G.c9A);
  const liya = await child('Liya', G.c9B);
  const parent = async (name, kids) => {
    const p = (await call(A, 'POST', '/accounts/parents', { full_name: name, phone: '0911000000', email: `g32.${name.toLowerCase()}.${tag}@asms.et` })).body.data;
    for (const k of kids) await call(A, 'POST', `/accounts/parents/${p.id}/children`, { student_id: k, relationship: 'mother' });
    const l = (await call(null, 'POST', '/auth/login', { email: `g32.${name.toLowerCase()}.${tag}@asms.et`, password: p.temporary_password })).body.data.accessToken;
    return (await call(l, 'POST', '/auth/change-password', { currentPassword: p.temporary_password, newPassword: 'G32#pass2026' })).body.data.accessToken;
  };
  const P1 = await parent('Hiwot', [kidist, kaleb]);
  const P2 = await parent('Selam', [liya]);
  await call(A, 'DELETE', `/students/${kaleb}`);   // archived
  // Meron: no class yet, the only child of parent 3
  const meron = (await call(A, 'POST', '/students', { first_name: 'Meron', last_name: `G32${tag}`, gender: 'female' })).body.data.id;
  const P3 = await parent('Tigist', [meron]);

  // Teacher A (teaches 9A) gets a phone for the contact check; put back at the end
  const tA = (await call(A, 'GET', `/teachers/${G.tA.tid}`)).body.data;
  const phone = `09${tag.slice(-8).replace(/\D/g, '7').padStart(8, '7')}`;
  await call(A, 'PUT', `/teachers/${G.tA.tid}`, { phone });
  const exam = (await call(A, 'POST', '/grades/exams', { class_id: G.c9A, subject_id: G.math, name: `G32 ${tag}`, exam_type: 'quiz', max_score: 1, semester: 1 })).body.data?.id;
  await call(A, 'POST', '/grades', { exam_id: exam, grades: [{ student_id: kidist, score: 1 }] });
  try {
    console.log('== GET /parent/children');
    const kids = (await call(P1, 'GET', '/parent/children')).body?.data ?? [];
    const k = kids.find((x) => x.id === kidist), kb = kids.find((x) => x.id === kaleb);
    ok(kids.length === 2 && !!k && !!kb && !kids.some((x) => x.id === liya), 'parent 1: Kidist and Kaleb, not Liya', kids.map((x) => x.first_name).join());
    ok(k?.first_name_am === 'ቅድስት' && k?.fathers_name_am === 'አለሙ' && k?.last_name_am === 'ገ32' && k?.fathers_name === 'Alemu', 'Amharic names and the father\'s name');
    ok(k?.class_id === G.c9A && k?.class_name === 'Grade 9 Section A' && k?.academic_year_id === year.id && k?.year_is_current === true && !!k?.academic_year_end,
      'class id and name, year id, end date and year_is_current');
    ok(kb?.status === 'withdrawn', 'an archived child is still listed, with its status (withdrawn)', kb?.status);

    console.log('== GET /attendance/student/:id?from&to');
    // Megabit 2017 E.C. = 2025-03-10 .. 2025-04-08 (two Gregorian months)
    for (const [date, status] of [['2025-03-10', 'absent'], ['2025-03-31', 'late'], ['2025-04-08', 'excused'], ['2025-04-09', 'absent']]) {
      const r = await call(A, 'POST', '/attendance', { class_id: G.c9A, date, records: [{ student_id: kidist, status }] });
      if (r.status !== 201) console.log('    mark', date, r.status, r.body?.message);
    }
    const range = (tok, id, q) => call(tok, 'GET', `/attendance/student/${id}?${q}`);
    let r = await range(P1, kidist, 'from=2025-03-10&to=2025-04-08');
    const d = r.body?.data;
    ok(r.status === 200 && d.from === '2025-03-10' && d.to === '2025-04-08' && d.records.length === 3 && d.records.every((x) => x.date >= '2025-03-10' && x.date <= '2025-04-08'),
      'parent: own child, an Ethiopian month across two Gregorian months: 3 days', `${r.status} ${d?.records?.map((x) => x.date).join()}`);
    ok(+d?.stats.absent === 1 && +d?.stats.late === 1 && +d?.stats.excused === 1 && +d?.stats.total_days === 3, 'totals: 1 absent, 1 late, 1 excused', JSON.stringify(d?.stats));
    r = await range(P1, kidist, 'from=2025-03-10&to=2025-03-10');
    ok(r.status === 200 && r.body.data.records.length === 1 && r.body.data.records[0].status === 'absent', 'one day (today\'s status on the child home)');
    ok((await range(P1, kidist, 'from=2025-03-10&to=2025-05-11')).status === 400 && (await range(P1, kidist, 'from=2025-03-10&to=2025-05-10')).status === 200, '62 days -> 200, 63 -> 400');
    ok((await range(P1, kidist, 'from=2025-04-08&to=2025-03-10')).status === 400, 'to before from -> 400');
    ok((await range(P1, kidist, 'from=2025-02-30&to=2025-03-10')).status === 400, 'not a real date -> 400');
    ok((await range(P1, kidist, 'from=2025-03-10')).status === 400, 'from without to -> 400');
    r = await range(P1, kidist, 'month=3&year=2025');
    ok(r.status === 200 && r.body.data.records.length === 2, 'month/year still works (March: 2 days)');

    console.log('== Scoping: parent 1 -> own child 200, another family 403');
    const portal = (id, cls) => [
      `/parent/child/${id}/summary`, `/parent/child/${id}/grades`, `/parent/child/${id}/attendance`,
      `/parent/child/${id}/fees`, `/parent/child/${id}/timetable`,
      `/results/student/${id}`, `/results/student/${id}?academic_year_id=${year.id}`,
      `/attendance/student/${id}?from=2025-03-10&to=2025-04-08`, `/attendance/student/${id}`,
      `/pdf/report-card/${id}`, `/pdf/report-card/${id}?academic_year_id=${year.id}`,
      `/exam-schedule/class/${cls}`, `/timetable/class/${cls}`, `/students/${id}`,
    ];
    const bodies = [];
    for (const p of portal(kidist, G.c9A)) {
      r = await call(P1, 'GET', p);
      bodies.push(r.text);
      ok(r.status === 200 || (r.status === 404 && p.endsWith('/timetable')), `own: ${p.replace(kidist, ':kidist').replace(G.c9A, ':9A')} -> ${r.status}`);
    }
    for (const p of portal(liya, G.c9B)) {
      r = await call(P1, 'GET', p);
      ok(r.status === 403, `other family: ${p.replace(liya, ':liya').replace(G.c9B, ':9B')} -> 403`, String(r.status));
    }
    const ry = (await call(P1, 'GET', `/results/student/${kidist}`)).body?.data?.years ?? [];
    ok(ry.length >= 1 && ry[0].id === year.id && ry[0].is_current === true && !!ry[0].end_date && !!ry[0].name, 'results: the years with results for the picker (current year first)', JSON.stringify(ry));
    r = await call(P2, 'GET', `/results/student/${kidist}`);
    ok(r.status === 403, "and the other way round: parent 2 -> Kidist's results 403");
    for (const p of ['/parent/children', '/parent/fees', '/parent/profile', '/exam-schedule/upcoming?days=365', `/parent/child/${kaleb}/summary`, `/results/student/${kaleb}`]) {
      r = await call(P1, 'GET', p);
      bodies.push(r.text);
      ok(r.status === 200 || r.status === 404, `${p.replace(kaleb, ':kaleb (archived)')} -> ${r.status}`);
    }
    const up = JSON.parse(bodies.at(-3)).data;
    ok(up.every((e) => e.class_name === 'Grade 9 Section A'), 'upcoming exams: own child\'s class only', [...new Set(up.map((e) => e.class_name))].join());
    const fees = JSON.parse(bodies.at(-5)).data.children.map((c) => c.student_id);
    ok(fees.length === 2 && fees.includes(kidist) && !fees.includes(liya), '/parent/fees: own children only');
    ok((await call(P1, 'GET', `/exam-schedule/class/${G.c9A}`)).body.data.every((e) => 'subject_name_am' in e), 'class exams carry the Amharic subject name');

    console.log('== A child without a class: results 200, empty');
    const mk = ((await call(P3, 'GET', '/parent/children')).body?.data ?? [])[0];
    ok(mk?.id === meron && mk.class_id === null && mk.class_name === null && mk.year_is_current === false, 'parent 3: Meron, no class, not a current year', JSON.stringify(mk && { class_id: mk.class_id, year_is_current: mk.year_is_current }));
    r = await call(P3, 'GET', `/results/student/${meron}`);
    const e = r.body?.data;
    ok(r.status === 200 && e?.student?.id === meron && e.class === null && e.academic_year === null && e.semesters === null && e.year === null && Array.isArray(e.years) && e.years.length === 0,
      'no class, no scores -> 200 with class, year and semesters null, no years', `${r.status} ${r.body?.message}`);
    r = await call(P3, 'GET', `/results/student/${meron}?academic_year_id=${year.id}`);
    ok(r.status === 200 && r.body.data.class === null, 'and for a given year -> 200, empty', String(r.status));
    r = await call(A, 'GET', `/results/student/${meron}`);
    ok(r.status === 200 && r.body.data.class === null, 'admin -> 200, empty', String(r.status));
    r = await call(P3, 'GET', `/pdf/report-card/${meron}`);
    ok(r.status === 200, 'report card PDF still 200 ("No results yet")', String(r.status));
    ok((await call(P1, 'GET', `/results/student/${meron}`)).status === 403 && (await call(P3, 'GET', `/results/student/${kidist}`)).status === 403,
      'another family: Meron for parent 1, Kidist for parent 3 -> 403');
    ok((await call(A, 'GET', '/results/student/00000000-0000-4000-8000-000000000000')).status === 404, 'unknown student -> 404');

    console.log('== No teacher phone or email in any parent response');
    const leaks = bodies.filter((b) => b.includes(G.tA.email) || b.includes(phone));
    ok(bodies.length >= 20 && leaks.length === 0, `${bodies.length} responses, none with teacher A's email or phone`, leaks.map((b) => b.slice(0, 80)).join(' | '));
    const tt = await call(P1, 'GET', `/parent/child/${kidist}/timetable`);
    const slots = tt.status === 200 ? Object.values(tt.body.data.by_day).flat() : [];
    ok(slots.every((s) => !('phone' in s) && !('email' in s) && !('teacher_phone' in s) && !('teacher_email' in s)), `timetable: teacher names only (${slots.length} slot(s))`);
    ok(slots.every((s) => 'subject_name_am' in s && 'teacher' in s), 'timetable: the Amharic subject name and the teacher name');
  } finally {
    await call(A, 'PUT', `/teachers/${G.tA.tid}`, { phone: tA.phone ?? '' });
    await pool.query('DELETE FROM attendance WHERE student_id = $1', [kidist]);
    for (const id of [kidist, liya, meron]) await call(A, 'DELETE', `/students/${id}`);
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
