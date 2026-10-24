// Phase 2 M7: timetable management. Slot create, edit and delete audited (with names and the old
// values); an edit changes only the fields sent (teacher and room cleared with null, times checked);
// a deactivated teacher refused; GET /timetable/conflicts lists teacher double bookings of a class in
// its year only; GET /timetable/teacher/:id?academic_year_id=; POST /timetable/copy: only into a
// class without slots (409), subjects, days, periods, times and rooms copied; the teacher: same year,
// the target class's assigned teacher of the subject when active and free, another year the slot's own
// teacher when free (reported otherwise); inactive subjects skipped (reported), copying from
// last year's class; one audit entry; teacher 403 on writes and conflicts. Scratch DB on :3100.
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
const tag = Date.now().toString(36).slice(-5).toUpperCase();
const lastAudit = async (action, targetId) => (await pool.query(
  'SELECT * FROM audit_logs WHERE action = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT 1', [action, targetId])).rows[0];

(async () => {
  console.log('[g34] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  // Last year: 5A. This year: 5A, 5B, 5C (all empty classes of two new test years)
  const last = (await createFreeYear(call, A, 7500, 8000)).body.data;
  const y = Number(last.name.slice(0, 4)) + 1;
  const thisYear = (await call(A, 'POST', '/academic-years', { name: `${y}/${y + 1}`, start_date: `${y}-09-01`, end_date: `${y + 1}-07-31` })).body.data;
  const mk = async (yearId, section) => (await call(A, 'POST', '/classes', { academic_year_id: yearId, grade_level: 5, section })).body.data.id;
  const old5A = await mk(last.id, 'A'), c5A = await mk(thisYear.id, 'A'), c5B = await mk(thisYear.id, 'B'), c5C = await mk(thisYear.id, 'C');
  ok(!!thisYear?.id && !!old5A && !!c5A && !!c5B && !!c5C, `years ${last.name}, ${thisYear?.name}; classes 5A / 5A, 5B, 5C`);
  // An extra subject (deactivated later) and an extra teacher (deactivated later)
  const sub = (await call(A, 'POST', '/subjects', { name: 'Art G34', code: `ART-${tag.slice(-4)}` })).body.data;
  const tch = (await call(A, 'POST', '/teachers', { first_name: 'Abebe', last_name: `G34${tag}`, email: `g34.${tag.toLowerCase()}@asms.et`, gender: 'male' })).body.data;
  const tchId = tch?.teacher?.id ?? tch?.id;
  ok(!!sub?.id && !!tchId, 'subject Art and teacher Abebe created');
  const classes = [old5A, c5A, c5B, c5C];
  const slot = (class_id, day, period, more = {}) => call(A, 'POST', '/timetable',
    { class_id, subject_id: G.math, teacher_id: G.tB.tid, day, period, start_time: '08:00', end_time: '08:40', room: 'R1', ...more });
  try {
    console.log('== Create, edit, delete: audited');
    let r = await slot(c5A, 'Monday', 1);
    const s1 = r.body?.data?.id;
    let a = await lastAudit('timetable.slot_created', s1);
    ok(r.status === 201 && a?.new_data.class_name === 'Grade 5 Section A' && a.new_data.subject_name && a.new_data.teacher_name && a.new_data.start_time === '08:00',
      'create -> 201, audited with class, subject and teacher names', msg(r));
    r = await slot(c5A, 'Monday', 2, { start_time: '09:00', end_time: '08:40' });
    ok(r.status === 400, 'end before start -> 400', msg(r));
    r = await slot(c5A, 'Monday', 2, { start_time: '9am' });
    ok(r.status === 400, 'start "9am" -> 400', msg(r));
    r = await call(A, 'PUT', `/timetable/${s1}`, { room: 'R2' });
    ok(r.status === 200 && r.body.data.room === 'R2' && r.body.data.teacher_id === G.tB.tid && r.body.data.subject_id === G.math, 'edit the room only: teacher and subject kept', msg(r));
    a = await lastAudit('timetable.slot_updated', s1);
    ok(a?.new_data.room === 'R2' && a.new_data.old.room === 'R1', 'audited with the old and new slot');
    r = await call(A, 'PUT', `/timetable/${s1}`, { teacher_id: null, room: null });
    ok(r.status === 200 && r.body.data.teacher_id === null && r.body.data.room === null, 'teacher_id null and room null clear them', msg(r));
    r = await call(A, 'PUT', `/timetable/${s1}`, { start_time: '08:50' });
    ok(r.status === 400, 'start after the end -> 400', msg(r));
    r = await call(A, 'PUT', `/timetable/${s1}`, { start_time: '07:50', end_time: '08:30', teacher_id: G.tB.tid });
    ok(r.status === 200 && r.body.data.start_time.startsWith('07:50') && r.body.data.end_time.startsWith('08:30'), 'new times and the teacher back', msg(r));
    r = await call(A, 'PUT', `/timetable/${s1}`, { subject_id: null });
    ok(r.status === 400, 'subject_id null -> 400', msg(r));
    for (const [tok, who] of [[TA, 'teacher']]) {
      const codes = [(await slot(c5A, 'Monday', 3)).status, (await call(tok, 'PUT', `/timetable/${s1}`, { room: 'X' })).status,
        (await call(tok, 'DELETE', `/timetable/${s1}`)).status, (await call(tok, 'POST', '/timetable/copy', { from_class_id: c5A, to_class_id: c5C })).status];
      ok(codes.slice(1).every((c) => c === 403), `${who}: edit, delete, copy -> 403`, codes.slice(1).join());
      await pool.query("DELETE FROM timetable WHERE class_id = $1 AND day = 'Monday' AND period = 3", [c5A]);
    }

    console.log('== A deactivated teacher');
    r = await call(A, 'PUT', `/teachers/${tchId}`, { is_active: false });
    r = await slot(c5A, 'Monday', 4, { teacher_id: tchId });
    ok(r.status === 400 && r.body?.errors?.field === 'teacher_id', 'new slot with a deactivated teacher -> 400 (field teacher_id)', msg(r));
    r = await call(A, 'PUT', `/timetable/${s1}`, { teacher_id: tchId });
    ok(r.status === 400, 'giving a slot a deactivated teacher -> 400', msg(r));
    await call(A, 'PUT', `/teachers/${tchId}`, { is_active: true });

    console.log('== Conflicts and the teacher timetable per year');
    // 5B Monday 1 with teacher B: refused now, so put it in directly like old data
    await pool.query(`INSERT INTO timetable (class_id, subject_id, teacher_id, day, period, start_time, end_time)
                      VALUES ($1, $2, $3, 'Monday', 1, '08:00', '08:40')`, [c5B, G.math, G.tB.tid]);
    await slot(old5A, 'Monday', 1);   // last year, same teacher and time: not a conflict
    r = await call(A, 'GET', `/timetable/conflicts?class_id=${c5A}`);
    ok(r.status === 200 && r.body.data.length === 1 && r.body.data[0].slot_id === s1 && r.body.data[0].other_class_id === c5B && r.body.data[0].other_class_name === 'Grade 5 Section B',
      "5A: one conflict, teacher B also in 5B on Monday 1 (last year's 5A not counted)", JSON.stringify(r.body?.data?.map((x) => x.other_class_name)));
    r = await call(A, 'GET', `/timetable/conflicts?class_id=${old5A}`);
    ok(r.status === 200 && r.body.data.length === 0, "last year's 5A: no conflicts", msg(r));
    ok((await call(A, 'GET', '/timetable/conflicts?class_id=nope')).status === 400 && (await call(A, 'GET', '/timetable/conflicts')).status === 400, 'bad or missing class_id -> 400');
    ok((await call(TA, 'GET', `/timetable/conflicts?class_id=${c5A}`)).status === 403, 'teacher -> 403');
    r = await call(A, 'GET', `/timetable/teacher/${G.tB.tid}?academic_year_id=${thisYear.id}`);
    ok(r.status === 200 && r.body.data.all_slots.length === 2 && r.body.data.all_slots.every((s) => s.academic_year_id === thisYear.id && s.class_id),
      "teacher B's timetable of this test year: 2 slots with class and year", String(r.body?.data?.all_slots?.length));
    ok((await call(A, 'GET', `/timetable/teacher/${G.tB.tid}?academic_year_id=x`)).status === 400, 'bad academic_year_id -> 400');
    r = await call(A, 'PUT', `/timetable/${s1}`, { room: 'R9', end_time: '08:30' });
    ok(r.status === 200 && r.body.data.room === 'R9', 'a slot that already clashes: room and times can still change (teacher kept)', msg(r));
    await call(A, 'PUT', `/timetable/${s1}`, { teacher_id: null });
    r = await call(A, 'PUT', `/timetable/${s1}`, { teacher_id: G.tB.tid });
    ok(r.status === 409 && /Grade 5 Section B/.test(r.body?.message), 'putting teacher B back into the clash -> 409', msg(r));
    await pool.query('DELETE FROM timetable WHERE class_id = $1', [c5B]);
    await call(A, 'PUT', `/timetable/${s1}`, { teacher_id: G.tB.tid, room: null });

    console.log('== Copy');
    // 5A this year: Monday 1 (teacher B), Tuesday 2 (teacher Abebe), Wednesday 3 (Art, no teacher), Saturday 1
    await slot(c5A, 'Tuesday', 2, { teacher_id: tchId, room: 'Lab' });
    await slot(c5A, 'Wednesday', 3, { subject_id: sub.id, teacher_id: null, start_time: '10:00', end_time: '10:40' });
    await slot(c5A, 'Saturday', 1, { teacher_id: null });
    await slot(c5C, 'Thursday', 5, { teacher_id: null });
    r = await call(A, 'POST', '/timetable/copy', { from_class_id: c5A, to_class_id: c5C });
    ok(r.status === 409 && /already has 1 slot/.test(r.body?.message), 'into a class with slots -> 409', msg(r));
    await pool.query('DELETE FROM timetable WHERE class_id = $1', [c5C]);
    await call(A, 'PUT', `/subjects/${sub.id}`, { is_active: false });
    // Same year: the teacher comes from 5B's class assignments (Abebe teaches Mathematics there)
    r = await call(A, 'POST', `/teachers/${tchId}/classes`, { class_id: c5B, subject_id: G.math });
    ok(r.status === 201 || r.status === 200, 'Abebe assigned to 5B for Mathematics', msg(r));
    r = await call(A, 'POST', '/timetable/copy', { from_class_id: c5A, to_class_id: c5B });
    const rep = r.body?.data;
    ok(r.status === 201 && rep.copied === 3 && rep.same_year === true && rep.with_teacher === 2, '5A -> 5B (same year): 201, 3 slots copied, 2 with a teacher', msg(r));
    ok(rep?.skipped_slots.length === 1 && rep.skipped_slots[0].reason === 'subject_inactive' && rep.skipped_slots[0].day === 'Wednesday',
      'the inactive subject (Art) not copied, reported', JSON.stringify(rep?.skipped_slots));
    ok(rep?.teachers_skipped.length === 1 && rep.teachers_skipped[0].reason === 'teacher_clash' && rep.teachers_skipped[0].day === 'Tuesday'
      && rep.teachers_skipped[0].clash_class_name === 'Grade 5 Section A' && /^Abebe/.test(rep.teachers_skipped[0].teacher_name),
      "Tuesday 2: Abebe busy in 5A then -> no teacher, reported with the class", JSON.stringify(rep?.teachers_skipped));
    let copied = (await call(A, 'GET', `/timetable/class/${c5B}`)).body.data.all_slots;
    const mon = copied.find((s) => s.day === 'Monday'), tue = copied.find((s) => s.day === 'Tuesday'), sat = copied.find((s) => s.day === 'Saturday');
    ok(mon && mon.teacher_id === tchId && mon.subject_id === G.math && mon.start_time.startsWith('07:50'), "Monday 1: subject and times copied, 5B's teacher Abebe (not 5A's teacher B)");
    ok(tue && tue.teacher_id === null && tue.room === 'Lab' && tue.period === 2, 'Tuesday 2: the room copied, no teacher');
    ok(sat && sat.teacher_id === tchId, "Saturday 1 (no teacher in 5A): 5B's teacher Abebe");
    a = await lastAudit('timetable.copied', c5B);
    ok(a?.new_data.copied === 3 && a.new_data.from_class_id === c5A && a.new_data.teachers_skipped.length === 1, 'one audit entry timetable.copied with the report');
    r = await call(A, 'POST', '/timetable/copy', { from_class_id: c5A, to_class_id: c5B });
    ok(r.status === 409, 'copied again -> 409 (not empty any more)', msg(r));
    const [r1, r2] = await Promise.all([
      call(A, 'POST', '/timetable/copy', { from_class_id: c5A, to_class_id: c5C }),
      call(A, 'POST', '/timetable/copy', { from_class_id: c5A, to_class_id: c5C })]);
    ok([r1.status, r2.status].sort().join() === '201,409', 'two copies into 5C at once: one 201, one 409', `${r1.status} ${r2.status}`);
    ok((await pool.query('SELECT COUNT(*)::int n FROM timetable WHERE class_id = $1', [c5C])).rows[0].n === 3, '5C has 3 slots, not 6');
    const won = r1.status === 201 ? r1.body.data : r2.body.data;
    ok(won.with_teacher === 0 && won.teachers_skipped.length === 3 && won.teachers_skipped.every((x) => x.reason === 'no_assignment'),
      'same year, 5C has no Mathematics teacher assigned: all 3 without a teacher, reported no_assignment', JSON.stringify(won.teachers_skipped.map((x) => x.reason)));

    // Last year's 5A (Monday 1 teacher B, Thursday 4 and Friday 4 teacher Abebe) into this year's new 5D
    await slot(old5A, 'Thursday', 4, { teacher_id: tchId });
    await slot(old5A, 'Friday', 4, { teacher_id: tchId });
    const c5D = await mk(thisYear.id, 'D'); classes.push(c5D);
    r = await call(A, 'POST', '/timetable/copy', { from_class_id: old5A, to_class_id: c5D });
    copied = (await call(A, 'GET', `/timetable/class/${c5D}`)).body.data.all_slots;
    ok(r.status === 201 && r.body.data.copied === 3 && r.body.data.teachers_skipped.length === 1 && r.body.data.teachers_skipped[0].day === 'Monday',
      "last year's 5A -> this year's 5D: 3 copied; teacher B left out on Monday 1 (busy in this year's 5A)", msg(r));
    ok(copied.filter((s) => s.teacher_id === tchId).length === 2, 'teacher Abebe kept on Thursday 4 and Friday 4 (free this year)');
    // A deactivated teacher is copied as no teacher
    const c5E = await mk(thisYear.id, 'E'); classes.push(c5E);
    await pool.query('DELETE FROM timetable WHERE class_id = $1', [c5D]);
    await call(A, 'PUT', `/teachers/${tchId}`, { is_active: false });
    r = await call(A, 'POST', '/timetable/copy', { from_class_id: old5A, to_class_id: c5E });
    ok(r.status === 201 && r.body.data.teachers_skipped.filter((x) => x.reason === 'teacher_inactive').length === 2, 'a deactivated teacher: reported teacher_inactive, slots copied without one', msg(r));
    // Same year, the assigned teacher deactivated: no teacher, reported teacher_inactive
    const g6 = (await call(A, 'POST', '/classes', { academic_year_id: thisYear.id, grade_level: 6, section: 'A' })).body.data.id;
    classes.push(g6);
    await pool.query('INSERT INTO teacher_classes (teacher_id, class_id, subject_id) VALUES ($1, $2, $3)', [tchId, g6, G.math]);
    r = await call(A, 'POST', '/timetable/copy', { from_class_id: c5A, to_class_id: g6 });
    ok(r.status === 201 && r.body.data.with_teacher === 0 && r.body.data.teachers_skipped.filter((x) => x.reason === 'teacher_inactive').length === 3,
      "same year, 6A's Mathematics teacher deactivated: copied without a teacher, reported teacher_inactive", msg(r));
    await call(A, 'PUT', `/teachers/${tchId}`, { is_active: true });
    ok((await call(A, 'POST', '/timetable/copy', { from_class_id: c5A, to_class_id: c5A })).status === 400, 'into itself -> 400');
    ok((await call(A, 'POST', '/timetable/copy', { from_class_id: c5D, to_class_id: c5E })).status === 409, 'into a class with slots (5E) -> 409');
    await pool.query('DELETE FROM timetable WHERE class_id = $1', [c5E]);
    ok((await call(A, 'POST', '/timetable/copy', { from_class_id: c5D, to_class_id: c5E })).status === 400, 'from a class without slots (5D) -> 400');
    r = await call(A, 'POST', '/timetable/copy', { from_class_id: 'nope', to_class_id: c5B });
    ok(r.status === 400 && /from_class_id does not exist/.test(r.body?.message), 'malformed from_class_id -> 400 naming the field', msg(r));
    ok((await call(A, 'POST', '/timetable/copy', { to_class_id: c5B })).status === 400, 'missing from_class_id -> 400');

    console.log('== Delete');
    r = await call(A, 'DELETE', `/timetable/${s1}`);
    a = await lastAudit('timetable.slot_deleted', s1);
    ok(r.status === 200 && a?.new_data.day === 'Monday' && a.new_data.class_name === 'Grade 5 Section A', 'delete -> 200, audited with the slot', msg(r));
    ok((await call(A, 'DELETE', `/timetable/${s1}`)).status === 404, 'deleted again -> 404');
  } finally {
    await pool.query('DELETE FROM timetable WHERE class_id = ANY($1::uuid[])', [classes]);
    await pool.query('DELETE FROM teacher_classes WHERE class_id = ANY($1::uuid[])', [classes]);
    await pool.query('DELETE FROM subjects WHERE id = $1', [sub?.id]);
    if (tchId) await call(A, 'PUT', `/teachers/${tchId}`, { is_active: false });
    const left = (await pool.query('SELECT COUNT(*)::int n FROM timetable WHERE class_id = ANY($1::uuid[])', [classes])).rows[0].n;
    ok(left === 0, 'slots removed', String(left));
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
