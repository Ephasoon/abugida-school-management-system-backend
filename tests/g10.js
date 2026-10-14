// Phase 1 addition 1: both exam-creation endpoints follow one rule. Scratch DB, server :3100. Run via guard.sh.
const pool = require('./tdb');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
// Each run gets its own dates (base offset from the clock), so re-runs never collide
let day = Math.floor(Date.now() / 1000) % 20000;
const nextDate = () => new Date(Date.UTC(2030, 0, 1) + (day++) * 86400000).toISOString().slice(0, 10);
const NONE = '00000000-0000-0000-0000-000000000000';

(async () => {
  const T = {
    admin: await login('admin@asms.et', 'Admin@1234'), principal: await login('principal.g7@asms.et', 'Pass#2026'),
    tA: await login(G.tA.email, 'Pass#2026'), tB: await login(G.tB.email, 'Pass#2026'),
    student: await login(G.s1.email, 'Pass#2026'), parent: await login(G.parent.email, 'Pass#2026'),
  };
  const ENDPOINTS = { 'POST /grades/exams': '/grades/exams', 'POST /exam-schedule': '/exam-schedule' };
  const body = (cls, sub, extra = {}) => ({ class_id: cls, subject_id: sub, name: 'G10 exam', exam_type: 'quiz', term: 'term1', exam_date: nextDate(), ...extra });

  // ── Same rule on both endpoints ──
  const cases = [
    ['admin, any class (9B English)', 'admin', [G.c9B, G.eng], 201],
    ['teacher A, own class + subject (9A Math)', 'tA', [G.c9A, G.math], 201],
    ['teacher A, own class, other subject (9A English)', 'tA', [G.c9A, G.eng], 403],
    ['teacher A, other class (9B Math)', 'tA', [G.c9B, G.math], 403],
    ['teacher B, no assignments', 'tB', [G.c9A, G.math], 403],
    ['principal (view only)', 'principal', [G.c9A, G.math], 403],
    ['student', 'student', [G.c9A, G.math], 403],
    ['parent', 'parent', [G.c9A, G.math], 403],
  ];
  const valid = [
    ['bad exam_type', { exam_type: 'oral' }, 400],
    ['bad term', { term: 'annual' }, 400],
    ['max_score 0', { max_score: 0 }, 400],
    ['end_time before start_time', { start_time: '10:00', end_time: '09:00' }, 400],
    ['unknown class', { class_id: NONE }, 400],    // body ids: 400 "class_id does not exist." (G10)
    ['unknown subject', { subject_id: NONE }, 400],
  ];
  for (const [label, path] of Object.entries(ENDPOINTS)) {
    console.log(`== ${label}`);
    for (const [name, role, [cls, sub], exp] of cases) {
      const r = await call(T[role], 'POST', path, body(cls, sub));
      ok(r.status === exp, `${name} -> ${exp}`, r.status !== exp ? `got ${r.status} ${r.body?.message}` : '');
    }
    for (const [name, extra, exp] of valid) {
      const r = await call(T.admin, 'POST', path, body(G.c9A, G.math, extra));
      ok(r.status === exp, `${name} -> ${exp}`, r.status !== exp ? `got ${r.status} ${r.body?.message}` : '');
    }
  }

  // ── Same outcome stored ──
  console.log('== Stored exams');
  const viaGrades = await call(T.tA, 'POST', '/grades/exams', body(G.c9A, G.math, { name: 'G10 via grades' }));
  const viaSched  = await call(T.tA, 'POST', '/exam-schedule', body(G.c9A, G.math, { name: 'G10 via schedule', start_time: '08:30', end_time: '10:00', room: 'Hall', instructions: 'Pens only' }));
  const rows = (await pool.query('SELECT name, created_by, academic_year_id IS NOT NULL AS has_year FROM exams WHERE id = ANY($1) ORDER BY name', [[viaGrades.body.data.id, viaSched.body.data.id]])).rows;
  ok(rows.length === 2 && rows.every(r => r.created_by === G.tA.tid && r.has_year), 'teacher-created exams record created_by = teacher A and the academic year (both endpoints)');
  const sch = (await pool.query('SELECT to_char(start_time,\'HH24:MI\') s, room, instructions FROM exam_schedules WHERE exam_id = $1', [viaSched.body.data.id])).rows[0];
  ok(sch && sch.s === '08:30' && sch.room === 'Hall' && sch.instructions === 'Pens only', 'schedule details stored with the exam');
  ok(viaSched.body.data.class_name === 'Grade 9 Section A' && viaSched.body.data.room === 'Hall', 'exam-schedule response includes class_name and schedule fields');

  console.log('== Endpoint-specific behaviour');
  const noDate = (p) => call(T.admin, 'POST', p, { class_id: G.c9A, subject_id: G.math, name: 'G10 undated', exam_type: 'assignment', term: 'term1' });
  ok((await noDate('/exam-schedule')).status === 400, 'exam-schedule requires exam_date');
  ok((await noDate('/grades/exams')).status === 201, 'grades/exams allows an undated exam (e.g. assignment)');
  const conflictDate = nextDate();
  await call(T.admin, 'POST', '/exam-schedule', body(G.c9B, G.eng, { exam_date: conflictDate, start_time: '08:00', end_time: '09:00' }));
  ok((await call(T.admin, 'POST', '/exam-schedule', body(G.c9B, G.eng, { exam_date: conflictDate, start_time: '10:00', end_time: '11:00' }))).status === 409, 'same class, same date, timed -> 409 conflict');
  ok(viaGrades.headers.get('deprecation') === 'true' && /exam-schedule/.test(viaGrades.headers.get('link') || ''), 'grades/exams responses carry Deprecation + Link headers');
  ok(!viaSched.headers.get('deprecation'), 'exam-schedule is not marked deprecated');

  console.log('== No active academic year (both endpoints -> 400, not 500)');
  const cur = (await pool.query('SELECT id FROM academic_years WHERE is_current')).rows[0].id;
  await pool.query('UPDATE academic_years SET is_current = FALSE');
  try {
    for (const p of Object.values(ENDPOINTS)) ok((await call(T.admin, 'POST', p, body(G.c9A, G.math))).status === 400, `${p} without active year -> 400`);
  } finally {
    await pool.query('UPDATE academic_years SET is_current = (id = $1)', [cur]);
  }
  ok((await pool.query('SELECT COUNT(*)::int n FROM academic_years WHERE is_current AND id = $1', [cur])).rows[0].n === 1, 'active academic year restored');

  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
