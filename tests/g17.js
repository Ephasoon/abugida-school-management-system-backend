// G10 / BACKLOG "Validate ids in request bodies": malformed or unknown ids in a request
// body answer 400 and name the field ("class_id does not exist.", "grades[1].student_id
// does not exist."), the same message for both; never 500. Missing ids are left to each
// route's own "is required" check. Role and record-level 403s still come first.
// Scratch DB backend on :3100. Run via guard.sh. AUDIT=1 prints the status table without asserting.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('./tdb');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
const AUDIT = !!process.env.AUDIT;
let pass = 0, fail = 0; const fails = [];

const call = async (tok, method, p, body) => {
  const multipart = body instanceof FormData;
  const r = await fetch(API + p, {
    method,
    headers: { ...(multipart || !body ? {} : { 'Content-Type': 'application/json' }), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : null };
};
const login = async (email, password) => (await call(null, 'POST', '/auth/login', { email, password })).body?.data?.accessToken;
const check = (cond, label, extra = '') => { if (cond) pass++; else { fail++; fails.push(label + (extra ? '  ' + extra : '')); } };

// Malformed: text, a number, an almost-uuid, SQL-ish text, a uuid with trailing junk, an object
const MALFORMED = ['not-a-uuid', 12345, '9da409a3-0000-0000-0000-00000000000', "1' OR '1'='1", `${crypto.randomUUID()}x`, { id: 1 }];
const unknown = () => crypto.randomUUID();
const TAG = `g17-${Date.now().toString(36)}`; // names of anything a refused request might have written

// Sets a value at "a", "a[1]" or "a[1].b" in a copy of the body
const setAt = (body, field, value) => {
  const b = structuredClone(body);
  const m = field.match(/^(\w+)\[(\d+)\](?:\.(\w+))?$/);
  if (!m) { b[field] = value; return b; }
  if (m[3]) b[m[1]][+m[2]][m[3]] = value; else b[m[1]][+m[2]] = value;
  return b;
};
const form = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  f.append('file', new Blob(['%PDF-1.4 g17'], { type: 'application/pdf' }), 'g17.pdf');
  return f;
};

(async () => {
  console.log('[g17] db =', (await pool.query('select current_database() d')).rows[0].d);
  const parentId = (await pool.query('SELECT p.id FROM parents p JOIN users u ON u.id = p.user_id WHERE u.email = $1', [G.parent.email])).rows[0].id;
  const yearId = (await pool.query('SELECT id FROM academic_years WHERE is_current')).rows[0].id;
  const examId = (await pool.query("SELECT id FROM exams WHERE class_id = $1 AND subject_id = $2 LIMIT 1", [G.c9A, G.math])).rows[0]?.id;
  let slotId = (await pool.query('SELECT id FROM timetable LIMIT 1')).rows[0]?.id;
  const feeId = (await pool.query('SELECT id FROM fee_structures LIMIT 1')).rows[0]?.id;
  const uploadsBefore = fs.readdirSync(path.join(__dirname, '..', 'uploads', 'documents')).length;
  await pool.query("UPDATE users SET is_active = TRUE, must_change_password = FALSE WHERE email = ANY($1)", [[G.tA.email, G.tB.email]]);

  const A = await login('admin@asms.et', 'Admin@1234');
  const TA = await login(G.tA.email, 'Pass#2026'), TB = await login(G.tB.email, 'Pass#2026');
  if (!A || !TA || !TB) { console.log('login failed'); process.exit(1); }
  if (!slotId) {
    const r = await call(A, 'POST', '/timetable', { class_id: G.c9B, subject_id: G.math, day: 'Saturday', period: 1, start_time: '08:00', end_time: '08:40' });
    slotId = r.body?.data?.id;
  }
  const S1 = G.s1.sid, S2 = G.s2.sid;

  // [method, path, body (valid except for the field under test), fields to test, token]
  const R = [
    ['POST', `/academic-years/${yearId}/promote`, { from_year_id: yearId }, ['from_year_id'], A],
    ['POST', `/accounts/parents/${parentId}/children`, { student_id: S1, relationship: 'guardian' }, ['student_id'], A],
    ['POST', '/attendance', { class_id: G.c9A, date: '2026-01-05', records: [{ student_id: S1, status: 'present' }, { student_id: S2, status: 'present' }] }, ['class_id', 'records[1].student_id'], A],
    ['POST', '/documents/upload', { category: 'other', title: TAG, student_id: S1, teacher_id: G.tA.tid }, ['student_id', 'teacher_id'], A, true],
    ['POST', '/exam-schedule', { class_id: G.c9A, subject_id: G.math, name: TAG, exam_type: 'quiz', term: 'term1', exam_date: '2026-12-01', max_score: 5 }, ['class_id', 'subject_id'], A],
    ['POST', '/grades/exams', { class_id: G.c9A, subject_id: G.math, name: TAG, exam_type: 'quiz', term: 'term1', max_score: 5 }, ['class_id', 'subject_id'], A],
    ['POST', '/grades', { exam_id: examId, grades: [{ student_id: S1, score: 1 }, { student_id: S2, score: 1 }] }, ['exam_id', 'grades[1].student_id'], A],
    ['POST', '/finance/payments', { student_id: S1, fee_structure_id: feeId, amount_due: 1, amount_paid: 1, payment_method: 'cash', payment_date: '2026-10-01' }, ['student_id', 'fee_structure_id'], A],
    ['POST', '/students', { first_name: TAG, last_name: 'Body', gender: 'female', class_id: G.c9A }, ['class_id'], A],
    ['PUT', `/students/${S1}`, { class_id: G.c9A }, ['class_id'], A],
    ['POST', `/teachers/${G.tA.tid}/subjects`, { subject_ids: [G.math, G.eng] }, ['subject_ids[1]'], A],
    ['POST', `/teachers/${G.tA.tid}/classes`, { class_id: G.c9A, subject_id: G.math }, ['class_id', 'subject_id'], A],
    ['POST', '/timetable', { class_id: G.c9B, subject_id: G.math, teacher_id: G.tA.tid, day: 'Saturday', period: 8, start_time: '15:00', end_time: '15:40' }, ['class_id', 'subject_id', 'teacher_id'], A],
    ['PUT', `/timetable/${slotId}`, { subject_id: G.math, teacher_id: G.tA.tid }, ['subject_id', 'teacher_id'], A],
  ];

  const table = [];
  for (const [method, p, body, fields, tok, multipart] of R) {
    for (const field of fields) {
      const route = `${method} ${p.replace(/[0-9a-f-]{36}/g, ':id')}  ${field}`;
      const statuses = [];
      for (const v of [...MALFORMED, unknown()]) {
        const b = setAt(body, field, v);
        const r = await call(tok, method, p, multipart ? form(b) : b);
        statuses.push(r.status);
        const kind = typeof v === 'string' && v.length === 36 && !v.includes(' ') ? 'unknown' : `malformed ${JSON.stringify(v)}`;
        check(r.status === 400 && r.body?.message === `${field} does not exist.` && r.body?.errors?.field === field,
          `${route} ${kind} -> 400 "${field} does not exist."`, `got ${r.status} ${r.body?.message || ''}`);
      }
      table.push({ route, malformed: [...new Set(statuses.slice(0, -1))].join('/'), unknown: statuses.at(-1) });
    }
  }

  // Nothing was written by the refused requests
  const leftovers = (await pool.query('SELECT (SELECT COUNT(*) FROM students WHERE first_name = $1)::int s, (SELECT COUNT(*) FROM exams WHERE name = $1)::int e, (SELECT COUNT(*) FROM documents WHERE title = $1)::int d', [TAG])).rows[0];
  check(leftovers.s === 0 && leftovers.e === 0 && leftovers.d === 0, 'refused requests wrote nothing (students, exams, documents)', JSON.stringify(leftovers));
  const uploadsAfter = fs.readdirSync(path.join(__dirname, '..', 'uploads', 'documents')).length;
  check(uploadsAfter === uploadsBefore, 'refused uploads leave no file behind', `${uploadsBefore} -> ${uploadsAfter}`);

  // A refused file type is 400, not 500 (multer's filter error)
  const wrongType = new FormData();
  wrongType.append('category', 'other'); wrongType.append('title', TAG);
  wrongType.append('file', new Blob(['x'], { type: 'text/plain' }), 'g17.txt');
  const wt = await call(A, 'POST', '/documents/upload', wrongType);
  check(wt.status === 400 && /File type not allowed/.test(wt.body?.message || ''), 'upload of a refused file type -> 400', `got ${wt.status} ${wt.body?.message}`);

  // Missing ids are still the route's own "required" error, not "does not exist"
  for (const [p, body, re] of [
    ['/students', { first_name: TAG, last_name: 'Body', gender: 'female', class_id: '' }, null],
    ['/teachers/' + G.tA.tid + '/classes', { subject_id: G.math }, /required/],
    ['/grades', { grades: [] }, /required/],
  ]) {
    const r = await call(A, 'POST', p, body);
    if (re) check(r.status === 400 && re.test(r.body?.message || ''), `POST ${p} without the id -> its own "required" message`, `got ${r.status} ${r.body?.message}`);
    else {
      check(r.status === 201, `POST ${p} with an empty class_id -> created without a class (as before)`, `got ${r.status} ${r.body?.message}`);
      if (r.body?.data?.id) await call(A, 'DELETE', `/students/${r.body.data.id}`);
    }
  }

  // 403s come first: teacher B is not assigned to 9A, a parent may not post grades
  const tbAtt = await call(TB, 'POST', '/attendance', { class_id: G.c9A, date: '2026-01-05', records: [{ student_id: 'not-a-uuid', status: 'present' }] });
  check(tbAtt.status === 403, 'teacher B, attendance for 9A with a bad student id -> 403 (class access first)', `got ${tbAtt.status}`);
  const tbGr = await call(TB, 'POST', '/teachers/' + G.tA.tid + '/classes', { class_id: 'not-a-uuid', subject_id: G.math });
  check(tbGr.status === 403, 'teacher, admin-only route with a bad id -> 403 (role first)', `got ${tbGr.status}`);

  // Valid ids still work, upper-case uuids too
  const ok1 = await call(A, 'PUT', `/students/${S1}`, { class_id: G.c9A.toUpperCase() });
  check(ok1.status === 200, 'PUT /students/:id with a valid (upper-case) class_id -> 200', `got ${ok1.status} ${ok1.body?.message}`);
  const ok2 = await call(TA, 'POST', '/attendance', { class_id: G.c9A, date: '2026-01-05', records: [{ student_id: S1, status: 'present' }] });
  check(ok2.status === 200 || ok2.status === 201, 'teacher A marks attendance with valid ids -> 2xx', `got ${ok2.status} ${ok2.body?.message}`);

  if (AUDIT) {
    const w = Math.max(...table.map(t => t.route.length));
    console.log(`${'route  field'.padEnd(w)}  malformed        unknown`);
    for (const t of table) console.log(`${t.route.padEnd(w)}  ${t.malformed.padEnd(15)}  ${t.unknown}`);
  }
  await pool.end();
  for (const f of fails) console.log('FAIL', f);
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail && !AUDIT ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
