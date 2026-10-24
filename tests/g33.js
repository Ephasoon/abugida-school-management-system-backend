// Phase 2 M7 (G3, migration 023): subjects. List with usage and ?status=, create and edit (codes
// upper case and unique ignoring case, Amharic name, grade, only the fields sent change), deactivate
// and reactivate, delete only an unused subject (409 with the usage otherwise), every change audited;
// an inactive subject refused for new timetable slots, class assignments, teacher subject lists
// (one already in the list may stay) and exams, but its data kept; principal reads, teacher reads,
// both 403 on writes. School setting period_times (validated, sorted, audited). Scratch DB on :3100.
const pool = require('./tdb');
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
  console.log('[g33] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const pr = (await call(A, 'POST', '/accounts/principals', { email: `g33p${tag.toLowerCase()}@asms.et`, display_name: 'G33 Principal' })).body.data;
  const P0 = await login(`g33p${tag.toLowerCase()}@asms.et`, pr.temporary_password);
  const P = (await call(P0, 'POST', '/auth/change-password', { currentPassword: pr.temporary_password, newPassword: 'G33#pass2026' })).body.data.accessToken;
  const made = [];
  const oldTimes = (await call(A, 'GET', '/settings')).body.data.period_times;
  let slotId = null, examId = null;
  try {
    console.log('== Create');
    let r = await call(A, 'POST', '/subjects', { name: '  Geography G33 ', name_am: ' ጂኦግራፊ ', code: ` geo-${tag.slice(-4)} `, grade_level: 9 });
    const geo = r.body?.data;
    if (geo?.id) made.push(geo.id);
    ok(r.status === 201 && geo.name === 'Geography G33' && geo.name_am === 'ጂኦግራፊ' && geo.code === `GEO-${tag.slice(-4)}` && geo.grade_level === 9 && geo.is_active === true && geo.in_use === false,
      'create: trimmed, code upper case, Amharic name, grade 9, active, not in use', msg(r));
    let a = await lastAudit('subject.created', geo?.id);
    ok(!!a && a.new_data.code === geo?.code && a.new_data.name_am === 'ጂኦግራፊ', 'audited subject.created');
    r = await call(A, 'POST', '/subjects', { name: 'Other', code: geo.code.toLowerCase() });
    ok(r.status === 409 && r.body?.errors?.field === 'code', 'same code in lower case -> 409 (field code)', msg(r));
    for (const [body, field, what] of [
      [{ code: 'X1' }, 'name', 'no name'], [{ name: 'X', code: 'TOO-LONG-CODE' }, 'code', 'code over 10'], [{ name: 'X', code: 'A B' }, 'code', 'code with a space'],
      [{ name: 'X', code: 'X1', grade_level: 13 }, 'grade_level', 'grade 13'], [{ name: 'X'.repeat(101), code: 'X1' }, 'name', 'name over 100'],
      [{ name: 'X', code: 'X1', is_active: false }, 'is_active', 'a new subject inactive'],
    ]) {
      r = await call(A, 'POST', '/subjects', body);
      ok(r.status === 400 && r.body?.errors?.field === field, `${what} -> 400 (field ${field})`, msg(r));
    }
    r = await call(A, 'POST', '/subjects', { name: `Music G33`, code: `MUS-${tag.slice(-4)}` });
    const mus = r.body?.data; if (mus?.id) made.push(mus.id);
    ok(r.status === 201 && mus.name_am === null && mus.grade_level === null, 'create without Amharic name and grade -> null (every grade)');

    console.log('== Edit');
    r = await call(A, 'PUT', `/subjects/${geo.id}`, { name_am: 'መልክዓ ምድር' });
    ok(r.status === 200 && r.body.data.name_am === 'መልክዓ ምድር' && r.body.data.name === 'Geography G33' && r.body.data.code === geo.code && r.body.data.grade_level === 9,
      'only the Amharic name changes', msg(r));
    a = await lastAudit('subject.updated', geo.id);
    ok(a?.new_data.old.name_am === 'ጂኦግራፊ' && a?.new_data.new.name_am === 'መልክዓ ምድር' && Object.keys(a.new_data.new).length === 1, 'audited with old and new value of the changed field only');
    r = await call(A, 'PUT', `/subjects/${geo.id}`, { grade_level: null, name_am: '' });
    ok(r.status === 200 && r.body.data.grade_level === null && r.body.data.name_am === null, 'grade and Amharic name cleared', msg(r));
    r = await call(A, 'PUT', `/subjects/${geo.id}`, { code: mus.code.toLowerCase() });
    ok(r.status === 409, 'code of another subject -> 409', msg(r));
    r = await call(A, 'PUT', `/subjects/${geo.id}`, { code: geo.code.toLowerCase() });
    ok(r.status === 200 && r.body.data.code === geo.code, 'its own code in lower case -> 200, stays upper case', msg(r));
    const before = (await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE target_id = $1", [geo.id])).rows[0].n;
    r = await call(A, 'PUT', `/subjects/${geo.id}`, { name: 'Geography G33' });
    const after = (await pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE target_id = $1", [geo.id])).rows[0].n;
    ok(r.status === 200 && before === after, 'nothing changed -> 200, no audit entry', msg(r));
    r = await call(A, 'PUT', `/subjects/${geo.id}`, { name: ' ' });
    ok(r.status === 400, 'empty name -> 400', msg(r));
    r = await call(A, 'PUT', `/subjects/not-a-uuid`, { name: 'X' });
    ok(r.status === 404, 'malformed id -> 404', msg(r));

    console.log('== Roles');
    ok((await call(P, 'GET', '/subjects')).status === 200 && (await call(TA, 'GET', '/subjects')).status === 200, 'principal and teacher read the list');
    for (const [tok, who] of [[P, 'principal'], [TA, 'teacher']]) {
      const codes = [(await call(tok, 'POST', '/subjects', { name: 'X', code: 'X9' })).status, (await call(tok, 'PUT', `/subjects/${geo.id}`, { name: 'X' })).status,
        (await call(tok, 'DELETE', `/subjects/${mus.id}`)).status];
      ok(codes.every((c) => c === 403), `${who}: create, edit, delete -> 403`, codes.join());
    }

    console.log('== In use, deactivate, delete');
    // Two free periods of 9A (other suites leave slots there)
    const taken = new Set((await pool.query('SELECT day, period FROM timetable WHERE class_id = $1', [G.c9A])).rows.map((x) => `${x.day}${x.period}`));
    const free = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].flatMap((day) => [1, 2, 3, 4, 5, 6, 7].map((period) => ({ day, period })))
      .filter((x) => !taken.has(`${x.day}${x.period}`));
    r = await call(A, 'POST', '/timetable', { class_id: G.c9A, subject_id: geo.id, ...free[0], start_time: '16:00', end_time: '17:00' });
    slotId = r.body?.data?.id;
    if (!slotId) console.log('    slot', msg(r));
    ok(!!slotId, 'a timetable slot of the new subject in 9A');
    r = await call(A, 'GET', '/subjects?status=active');
    let row = r.body.data.find((s) => s.id === geo.id);
    ok(row?.in_use === true && row.timetable_slots === 1, 'the list shows it in use (1 timetable slot)', JSON.stringify(row && { in_use: row.in_use, slots: row.timetable_slots }));
    r = await call(A, 'DELETE', `/subjects/${geo.id}`);
    ok(r.status === 409 && /Deactivate it instead/.test(r.body?.message) && r.body?.errors?.timetable_slots === 1, 'delete in use -> 409 with the usage', msg(r));
    r = await call(A, 'PUT', `/subjects/${geo.id}`, { is_active: false });
    ok(r.status === 200 && r.body.data.is_active === false, 'deactivate -> 200', msg(r));
    a = await lastAudit('subject.deactivated', geo.id);
    ok(!!a && a.new_data.code === geo.code, 'audited subject.deactivated');
    ok(!(await call(A, 'GET', '/subjects?status=active')).body.data.some((s) => s.id === geo.id)
      && (await call(A, 'GET', '/subjects?status=inactive')).body.data.some((s) => s.id === geo.id), '?status=active leaves it out, ?status=inactive has it');
    ok((await call(A, 'GET', '/subjects?status=gone')).status === 400, '?status=gone -> 400');
    ok((await call(A, 'GET', '/teachers/subjects')).body.data.find((s) => s.id === geo.id)?.is_active === false
      && (await call(A, 'GET', '/timetable/subjects')).body.data.find((s) => s.id === geo.id)?.is_active === false, 'the picker lists carry is_active');
    const tt = (await call(A, 'GET', `/timetable/class/${G.c9A}`)).body.data.all_slots;
    ok(tt.some((s) => s.id === slotId && s.subject_name === 'Geography G33'), "the existing slot stays in 9A's timetable");

    console.log('== An inactive subject refused for new data');
    r = await call(A, 'POST', '/timetable', { class_id: G.c9A, subject_id: geo.id, ...free[1], start_time: '15:00', end_time: '16:00' });
    ok(r.status === 400 && /inactive/.test(r.body?.message), 'new timetable slot -> 400 inactive', msg(r));
    r = await call(A, 'PUT', `/timetable/${slotId}`, { room: 'G33' });
    ok(r.status === 200, 'editing the existing slot (same subject) still works', msg(r));
    r = await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: G.c9A, subject_id: geo.id });
    ok(r.status === 400 && /inactive/.test(r.body?.message), 'class assignment -> 400 inactive', msg(r));
    const own = (await call(A, 'GET', `/teachers/${G.tB.tid}`)).body.data.subjects.map((s) => s.id ?? s.subject_id);
    r = await call(A, 'POST', `/teachers/${G.tB.tid}/subjects`, { subject_ids: [...own, geo.id] });
    ok(r.status === 400 && /inactive/.test(r.body?.message), "adding it to a teacher's subject list -> 400", msg(r));
    r = await call(A, 'POST', '/exam-schedule', { class_id: G.c9A, subject_id: geo.id, name: `G33 ${tag}`, exam_type: 'quiz', max_score: 1, exam_date: '2025-03-03' });
    ok(r.status === 400 && /inactive/.test(r.body?.message), 'new exam -> 400 inactive', msg(r));

    console.log('== Reactivate; a teacher list keeps an inactive subject');
    r = await call(A, 'PUT', `/subjects/${geo.id}`, { is_active: true });
    ok(r.status === 200 && r.body.data.is_active === true && !!(await lastAudit('subject.reactivated', geo.id)), 'reactivate -> 200, audited subject.reactivated');
    r = await call(A, 'POST', `/teachers/${G.tB.tid}/subjects`, { subject_ids: [...own, geo.id] });
    ok(r.status === 200, 'active again: added to teacher B\'s list', msg(r));
    examId = (await call(A, 'POST', '/exam-schedule', { class_id: G.c9A, subject_id: geo.id, name: `G33 ${tag}`, exam_type: 'quiz', max_score: 1, exam_date: '2025-03-03' })).body?.data?.id;
    ok(!!examId, 'and an exam of it');
    await call(A, 'PUT', `/subjects/${geo.id}`, { is_active: false });
    r = await call(A, 'POST', `/teachers/${G.tB.tid}/subjects`, { subject_ids: [...own, geo.id] });
    ok(r.status === 200, 'inactive again: re-saving teacher B\'s list that already has it -> 200', msg(r));
    r = await call(A, 'GET', '/subjects?status=inactive');
    row = r.body.data.find((s) => s.id === geo.id);
    ok(row?.teachers === 1 && row.exams === 1 && row.timetable_slots === 1, 'usage: 1 teacher, 1 exam, 1 slot', JSON.stringify(row && [row.teachers, row.exams, row.timetable_slots]));
    await call(A, 'POST', `/teachers/${G.tB.tid}/subjects`, { subject_ids: own });

    console.log('== Delete');
    r = await call(A, 'DELETE', `/subjects/${mus.id}`);
    ok(r.status === 200 && !(await pool.query('SELECT 1 FROM subjects WHERE id = $1', [mus.id])).rows[0], 'an unused subject -> deleted', msg(r));
    a = await lastAudit('subject.deleted', mus.id);
    ok(a?.new_data.code === mus.code && a.new_data.name === 'Music G33', 'audited subject.deleted with its name and code');
    ok((await call(A, 'DELETE', `/subjects/${mus.id}`)).status === 404, 'deleted again -> 404');
    made.splice(made.indexOf(mus.id), 1);

    console.log('== period_times setting');
    const times = Array.from({ length: 8 }, (_, i) => ({ period: 8 - i, start: `${String(7 + (7 - i)).padStart(2, '0')}:30`, end: `${String(8 + (7 - i)).padStart(2, '0')}:10` }));
    r = await call(A, 'PUT', '/settings/period_times', { value: times });
    ok(r.status === 200 && r.body.data.value.map((p) => p.period).join() === '1,2,3,4,5,6,7,8' && r.body.data.value[0].start === '07:30', 'saved, sorted by period', msg(r));
    a = (await pool.query("SELECT new_data FROM audit_logs WHERE action = 'settings.updated' ORDER BY created_at DESC LIMIT 1")).rows[0];
    ok(a?.new_data.key === 'period_times' && Array.isArray(a.new_data.old), 'audited settings.updated with the old value');
    const bad = (f) => { const v = JSON.parse(JSON.stringify(oldTimes)); f(v); return v; };
    for (const [value, what] of [
      [oldTimes.slice(0, 7), '7 periods'], [bad((v) => { v[1].period = 1; }), 'period 1 twice'], [bad((v) => { v[0].start = '8:00'; }), '"8:00"'],
      [bad((v) => { v[0].end = v[0].start; }), 'end = start'], [bad((v) => { v[1].start = '08:30'; }), 'period 2 starts before period 1 ends'], ['08:00', 'not a list'],
    ]) ok((await call(A, 'PUT', '/settings/period_times', { value })).status === 400, `${what} -> 400`);
    ok((await call(P, 'PUT', '/settings/period_times', { value: oldTimes })).status === 403, 'principal -> 403');
    ok(Array.isArray((await call(TA, 'GET', '/settings')).body.data.period_times), 'teachers read it');
  } finally {
    if (examId) await pool.query('DELETE FROM exams WHERE id = $1', [examId]);
    if (slotId) await call(A, 'DELETE', `/timetable/${slotId}`);
    await call(A, 'PUT', '/settings/period_times', { value: oldTimes });
    for (const id of made) await pool.query('DELETE FROM subjects WHERE id = $1', [id]);
    const left = (await pool.query("SELECT COUNT(*)::int n FROM subjects WHERE name LIKE '% G33'")).rows[0].n;
    ok(left === 0, 'test subjects removed', String(left));
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
