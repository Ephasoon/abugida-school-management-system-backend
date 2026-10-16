// Timetable conflicts per academic year: a teacher's slot in a class of another year (last
// year's timetable) does not block a slot at the same day and period, one in the same year
// still does (409), on create and on edit; a class's own slot always blocks; an edit does
// not conflict with itself. Scratch DB backend on :3100.
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
const msg = (r) => `${r.status} ${r.body?.message ?? ''}`;

(async () => {
  console.log('[g31] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  // Two test years one after the other ("last year" and "this year"), 6A in each and 6B this year
  const last = (await createFreeYear(call, A, 7000, 7500)).body.data;
  const y = Number(last.name.slice(0, 4)) + 1;
  const thisYear = (await call(A, 'POST', '/academic-years', { name: `${y}/${y + 1}`, start_date: `${y}-09-01`, end_date: `${y + 1}-07-31` })).body.data;
  const mkClass = async (yearId, section) => (await call(A, 'POST', '/classes', { academic_year_id: yearId, grade_level: 6, section })).body.data.id;
  const old6A = await mkClass(last.id, 'A'), new6A = await mkClass(thisYear.id, 'A'), new6B = await mkClass(thisYear.id, 'B');
  ok(!!thisYear?.id && !!old6A && !!new6A && !!new6B, `years ${last.name} and ${thisYear?.name}, classes 6A / 6A, 6B`);

  const slots = [];
  const slot = async (class_id, period, teacher_id = G.tB.tid, day = 'Tuesday') => {
    const r = await call(A, 'POST', '/timetable', { class_id, subject_id: G.math, teacher_id, day, period, start_time: '10:00', end_time: '10:40', room: 'G31' });
    if (r.body?.data?.id) slots.push(r.body.data.id);
    return r;
  };
  const put = (id, body) => call(A, 'PUT', `/timetable/${id}`, body);
  try {
    console.log('== Create');
    const oldSlot = await slot(old6A, 3);
    ok(oldSlot.status === 201, `last year: teacher B in 6A, Tuesday period 3 -> 201`, msg(oldSlot));
    const newSlot = await slot(new6A, 3);
    ok(newSlot.status === 201, "this year: teacher B in 6A at the same day and period -> 201 (last year's slot does not block)", msg(newSlot));
    const clash = await slot(new6B, 3);
    ok(clash.status === 409 && /^Teacher conflict/.test(clash.body?.message), 'this year: teacher B in 6B at the same time -> 409 teacher conflict', msg(clash));
    const classClash = await slot(new6A, 3, G.tA.tid);
    ok(classClash.status === 409 && /^Conflict: This class/.test(classClash.body?.message), '6A already has Tuesday period 3 (another teacher) -> 409 class conflict', msg(classClash));
    const noTeacher = await slot(new6B, 3, null);
    ok(noTeacher.status === 201, 'a slot without a teacher in 6B at that time -> 201', msg(noTeacher));

    console.log('== Edit');
    const b4 = await slot(new6B, 4, G.tB.tid, 'Wednesday');
    ok(b4.status === 201, 'teacher B in 6B, Wednesday period 4 -> 201', msg(b4));
    let r = await put(b4.body.data.id, { day: 'Tuesday', period: 5 });
    ok(r.status === 200 && r.body.data.day === 'Tuesday' && r.body.data.period === 5, 'move it to Tuesday period 5 -> 200', msg(r));
    r = await put(b4.body.data.id, { room: 'G31b' });
    ok(r.status === 200, 'edit without moving: no conflict with itself -> 200', msg(r));
    await call(A, 'DELETE', `/timetable/${noTeacher.body.data.id}`);
    r = await put(b4.body.data.id, { period: 3 });
    ok(r.status === 409 && /^Teacher conflict/.test(r.body?.message), 'move it to Tuesday period 3 (teacher B in 6A this year) -> 409 teacher conflict', msg(r));
    r = await put(oldSlot.body.data.id, { period: 5 });
    ok(r.status === 200 && r.body.data.period === 5, "last year's slot moved to Tuesday period 5 (this year's 6B slot then does not block) -> 200", msg(r));
    r = await put(oldSlot.body.data.id, { period: 3, teacher_id: G.tB.tid });
    ok(r.status === 200, "and back to period 3 -> 200 (this year's 6A slot does not block)", msg(r));
    const a6 = await slot(new6A, 6, null);
    r = await put(a6.body.data.id, { period: 3 });
    ok(r.status === 409 && /^Conflict: This class/.test(r.body?.message), "move a 6A slot onto 6A's Tuesday period 3 -> 409 class conflict (was a database error)", msg(r));
    r = await put(a6.body.data.id, { teacher_id: G.tB.tid, period: 5 });
    ok(r.status === 409 && /^Teacher conflict/.test(r.body?.message), 'give it teacher B at Tuesday period 5 (6B this year) -> 409', msg(r));
    r = await put(a6.body.data.id, { day: 'Sunday' });
    ok(r.status === 400, 'edit with day "Sunday" -> 400', msg(r));
    r = await put(a6.body.data.id, { period: 9 });
    ok(r.status === 400, 'edit with period 9 -> 400', msg(r));
  } finally {
    for (const id of slots) await call(A, 'DELETE', `/timetable/${id}`);
    const left = (await pool.query('SELECT COUNT(*)::int n FROM timetable WHERE class_id = ANY($1::uuid[])', [[old6A, new6A, new6B]])).rows[0].n;
    ok(left === 0, 'slots removed', String(left));
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
