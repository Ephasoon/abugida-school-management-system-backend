// Phase 2 M9: documents. Upload limits endpoint; Amharic file names in upload and download
// (RFC 5987); the content must match the declared type; the 12 categories; private vs shared
// per role (admin and principal all, a teacher own uploads + shared ones not about a student or
// about a student of their own classes, parents and students none); teachers upload only for
// students of their own classes; search (title, file name, student name and number) and
// filters (category, private, mine, student); edit by admin or the uploader; delete by admin
// only (row first, then the file); audit entries with old data; uploads land in UPLOAD_DIR
// (tests/uploads/documents). Scratch DB backend on :3100.
const fs = require('fs');
const path = require('path');
const pool = require('./tdb');
const UPLOADS = require('./uploadDir');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, p, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: type.includes('json') ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const msg = (r) => `${r.status} ${r.body?.message ?? ''}`;
const tag = Date.now().toString(36).slice(-5).toUpperCase();

const PDF = Buffer.from('%PDF-1.4\n% g37\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const upload = async (tok, fields, { name = 'doc.pdf', type = 'application/pdf', bytes = PDF } = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  const r = await fetch(`${API}/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const files = () => fs.readdirSync(UPLOADS).length;

(async () => {
  console.log('[g37] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const TA = await login(G.tA.email, 'Pass#2026');
  const TB = await login(G.tB.email, 'Pass#2026');
  const PAR = await login(G.parent.email, 'Pass#2026');
  const STU = await login(G.s1.email, 'Pass#2026');
  const pr = (await call(A, 'POST', '/accounts/principals', { email: `g37p${tag.toLowerCase()}@asms.et`, display_name: 'G37 Principal' })).body.data;
  const P0 = await login(`g37p${tag.toLowerCase()}@asms.et`, pr.temporary_password);
  const P = (await call(P0, 'POST', '/auth/change-password', { currentPassword: pr.temporary_password, newPassword: 'G37#pass2026' })).body.data.accessToken;
  // A student of teacher A's classes and one outside them
  const inA = (await pool.query(`SELECT s.id, s.student_number, s.first_name, s.last_name FROM students s
    WHERE s.class_id IN (SELECT tc.class_id FROM teacher_classes tc JOIN teachers t ON t.id = tc.teacher_id WHERE t.user_id = $1::uuid)
    AND s.id = $2`, [G.tA.id, G.s1.sid])).rows[0];
  const outA = (await pool.query(`SELECT s.id FROM students s WHERE s.class_id IS NOT NULL AND s.class_id NOT IN
    (SELECT tc.class_id FROM teacher_classes tc JOIN teachers t ON t.id = tc.teacher_id WHERE t.user_id = $1::uuid) LIMIT 1`, [G.tA.id])).rows[0];
  ok(!!inA && !!outA, 'fixture: s1 in teacher A\'s classes, another student outside them');
  const made = [];

  try {
    console.log('== Limits and categories');
    const lim = await call(TA, 'GET', '/documents/limits');
    ok(lim.status === 200 && lim.body.data.max_bytes === 10 * 1024 * 1024 && lim.body.data.extensions.includes('.docx') && lim.body.data.categories.length === 12,
      'GET /documents/limits: 10 MB, the extensions, 12 categories', msg(lim));
    const cats = (await call(A, 'GET', '/documents/categories')).body.data.map((c) => c.key);
    ok(['transfer_letter', 'report_card', 'national_exam'].every((k) => cats.includes(k)), 'categories include transfer letter, report card, national exam result');
    ok((await call(PAR, 'GET', '/documents/limits')).status === 403 && (await call(STU, 'GET', '/documents')).status === 403, 'parent and student: 403');

    console.log('== Upload: Amharic names, content check, categories, refused files leave nothing');
    const amName = `የልደት ምስክር ወረቀት ${tag}.pdf`;
    const before = files();
    const up = await upload(A, { title: `ልደት ${tag}`, category: 'birth_certificate', student_id: inA.id, is_private: 'false' }, { name: amName });
    ok(up.status === 201 && up.body.data.file_name === amName && up.body.data.is_private === false && up.body.data.student_number === inA.student_number,
      'admin upload with an Amharic file name: kept exactly; shared; the student joined', msg(up));
    const AM = up.body.data; made.push(AM.id);
    const row = (await pool.query('SELECT file_path FROM documents WHERE id = $1', [AM.id])).rows[0];
    ok(path.dirname(path.resolve(row.file_path)) === path.resolve(UPLOADS) && files() === before + 1, 'stored in UPLOAD_DIR (tests/uploads/documents)', row.file_path);
    const dl = await call(A, 'GET', `/documents/download/${AM.id}`);
    const cd = dl.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    ok(dl.status === 200 && star && decodeURIComponent(star[1]) === amName && Buffer.compare(dl.body, PDF) === 0,
      'download: RFC 5987 filename* decodes to the Amharic name; same bytes', cd);
    const n0 = files();
    const fake = await upload(A, { title: 'fake', category: 'photo' }, { name: 'x.png', type: 'image/png', bytes: Buffer.from('not a png at all') });
    ok(fake.status === 400 && fake.body.errors?.field === 'file' && files() === n0, 'content not matching its type (text as PNG): 400, no file left', msg(fake));
    const png = await upload(A, { title: `png ${tag}`, category: 'photo' }, { name: 'p.png', type: 'image/png', bytes: PNG });
    ok(png.status === 201 && png.body.data.is_private === true, 'a real PNG: 201, private by default', msg(png)); made.push(png.body.data?.id);
    const badCat = await upload(A, { title: 'x', category: 'diary' });
    const noTitle = await upload(A, { title: ' ', category: 'other' });
    const exe = await upload(A, { title: 'x', category: 'other' }, { name: 'x.exe', type: 'application/x-msdownload', bytes: Buffer.from('MZ') });
    ok(badCat.status === 400 && noTitle.status === 400 && exe.status === 400 && files() === n0 + 1, 'unknown category, empty title, .exe: 400, no files left',
      `${badCat.status} ${noTitle.status} ${exe.status}`);
    for (const c of ['transfer_letter', 'report_card', 'national_exam']) {
      const r = await upload(A, { title: `${c} ${tag}`, category: c, student_id: inA.id });
      ok(r.status === 201, `category ${c} accepted`, msg(r)); made.push(r.body.data?.id);
    }

    console.log('== Teachers: own classes only');
    const tOut = await upload(TA, { title: `out ${tag}`, category: 'letter', student_id: outA.id });
    ok(tOut.status === 403, 'teacher upload for a student outside own classes: 403', msg(tOut));
    const tIn = await upload(TA, { title: `teacher A private ${tag}`, category: 'letter', student_id: inA.id });
    ok(tIn.status === 201 && tIn.body.data.uploaded_by_name, 'teacher upload for a student of own class: 201, uploader name', msg(tIn)); made.push(tIn.body.data?.id);
    const sharedOut = await upload(A, { title: `shared out ${tag}`, category: 'letter', student_id: outA.id, is_private: 'false' }); made.push(sharedOut.body.data?.id);
    const sharedGen = await upload(A, { title: `shared general ${tag}`, category: 'report', is_private: 'false' }); made.push(sharedGen.body.data?.id);
    const privGen = await upload(A, { title: `private general ${tag}`, category: 'report' }); made.push(privGen.body.data?.id);
    const listA = (await call(TA, 'GET', `/documents?search=${tag}&limit=100`)).body.data.documents.map((d) => d.id);
    ok(listA.includes(AM.id) && listA.includes(tIn.body.data.id) && listA.includes(sharedGen.body.data.id)
      && !listA.includes(sharedOut.body.data.id) && !listA.includes(privGen.body.data.id) && !listA.includes(png.body.data.id),
      'teacher A list: own uploads, shared about own students, shared general; not shared about other classes, not private');
    ok((await call(TA, 'GET', `/documents/${sharedOut.body.data.id}`)).status === 404 && (await call(TA, 'GET', `/documents/download/${sharedOut.body.data.id}`)).status === 404,
      'teacher A: GET and download of a shared document about another class: 404');
    ok((await call(TA, 'GET', `/documents/student/${outA.id}`)).status === 403, 'teacher A: documents of a student outside own classes: 403');
    const stA = (await call(TA, 'GET', `/documents/student/${inA.id}`)).body.data.documents.map((d) => d.id);
    ok(stA.includes(AM.id) && stA.includes(tIn.body.data.id), 'teacher A: own student\'s shared and own documents');
    const tbList = (await call(TB, 'GET', `/documents?search=${tag}&limit=100`)).body.data.documents.map((d) => d.id);
    ok(!tbList.includes(tIn.body.data.id), 'teacher B does not see teacher A\'s private upload');
    const catsT = (await call(TA, 'GET', '/documents/categories')).body.data.reduce((a, c) => a + c.count, 0);
    const catsAll = (await call(A, 'GET', '/documents/categories')).body.data.reduce((a, c) => a + c.count, 0);
    ok(catsT < catsAll, 'category counts follow what the teacher may see', `${catsT} < ${catsAll}`);

    console.log('== Principal: sees all, uploads; no delete');
    const pList = (await call(P, 'GET', `/documents?search=${tag}&limit=100`)).body.data.documents.map((d) => d.id);
    ok(pList.includes(privGen.body.data.id) && pList.includes(tIn.body.data.id), 'principal sees private documents');
    const pUp = await upload(P, { title: `principal ${tag}`, category: 'report_card', student_id: outA.id });
    ok(pUp.status === 201, 'principal uploads', msg(pUp)); made.push(pUp.body.data?.id);
    ok((await call(P, 'DELETE', `/documents/${pUp.body.data.id}`)).status === 403 && (await call(TA, 'DELETE', `/documents/${tIn.body.data.id}`)).status === 403,
      'delete: principal and teacher 403');

    console.log('== Search and filters');
    const ids = async (q) => (await call(A, 'GET', `/documents?${q}&limit=100`)).body.data.documents.map((d) => d.id);
    ok((await ids(`search=${encodeURIComponent('ምስክር ወረቀት ' + tag)}`)).includes(AM.id), 'search by an Amharic file name');
    ok((await ids(`search=${inA.student_number}`)).includes(AM.id) && (await ids(`search=${encodeURIComponent(inA.first_name + ' ' + inA.last_name)}`)).includes(AM.id),
      'search by student number and by student name');
    const sharedOnly = await ids(`search=${tag}&is_private=false`);
    ok(sharedOnly.includes(AM.id) && !sharedOnly.includes(privGen.body.data.id), 'is_private=false: shared only');
    const mineT = (await call(TA, 'GET', `/documents?mine=true&search=${tag}`)).body.data.documents.map((d) => d.id);
    ok(mineT.length === 1 && mineT[0] === tIn.body.data.id, 'mine=true: own uploads only');
    const byCat = await ids(`search=${tag}&category=national_exam`);
    ok(byCat.length === 1, 'category filter');
    const byStu = await ids(`student_id=${outA.id}&search=${tag}`);
    ok(byStu.includes(sharedOut.body.data.id) && !byStu.includes(AM.id), 'student filter');
    ok((await call(A, 'GET', '/documents?category=diary')).status === 400 && (await call(A, 'GET', '/documents?student_id=x')).status === 400, 'bad filters: 400');

    console.log('== Edit: admin or the uploader');
    const e1 = await call(TA, 'PUT', `/documents/${tIn.body.data.id}`, { title: `teacher A renamed ${tag}`, category: 'transfer_letter', is_private: false });
    ok(e1.status === 200 && e1.body.data.title.startsWith('teacher A renamed') && e1.body.data.category === 'transfer_letter' && e1.body.data.is_private === false,
      'uploader (teacher) edits own document', msg(e1));
    ok((await call(TB, 'PUT', `/documents/${AM.id}`, { title: 'x' })).status === 404, 'teacher B: a document not visible to B: 404');
    ok((await call(TA, 'PUT', `/documents/${AM.id}`, { title: 'x' })).status === 403, 'teacher A: visible but not own: 403');
    ok((await call(P, 'PUT', `/documents/${AM.id}`, { title: 'x' })).status === 403, 'principal: not own: 403');
    const e2 = await call(A, 'PUT', `/documents/${AM.id}`, { description: 'ኦሪጅናል', is_private: true });
    ok(e2.status === 200 && e2.body.data.description === 'ኦሪጅናል' && e2.body.data.is_private === true && e2.body.data.title === `ልደት ${tag}`, 'admin edits any; untouched fields stay', msg(e2));
    ok((await call(A, 'PUT', `/documents/${AM.id}`, { category: 'diary' })).status === 400 && (await call(A, 'PUT', `/documents/${AM.id}`, { title: '' })).status === 400
      && (await call(A, 'PUT', `/documents/${AM.id}`, { is_private: 'yes' })).status === 400, 'edit validation: 400');

    console.log('== Delete: admin; audited; the file goes');
    const fp = (await pool.query('SELECT file_path FROM documents WHERE id = $1', [png.body.data.id])).rows[0].file_path;
    const del = await call(A, 'DELETE', `/documents/${png.body.data.id}`);
    ok(del.status === 200 && !fs.existsSync(fp) && (await pool.query('SELECT 1 FROM documents WHERE id = $1', [png.body.data.id])).rows.length === 0, 'admin delete: row and file gone', msg(del));
    ok((await call(A, 'DELETE', `/documents/${png.body.data.id}`)).status === 404, 'deleted again: 404');
    const audit = async (id) => (await pool.query('SELECT action, new_data, old_data FROM audit_logs WHERE target_id = $1 ORDER BY created_at', [id])).rows;
    const aAm = await audit(AM.id);
    ok(aAm.map((r) => r.action).join() === 'document.uploaded,document.updated' && aAm[0].new_data.file_name === amName
      && aAm[1].old_data.is_private === false && aAm[1].new_data.is_private === true, 'audit: uploaded (file name), updated (old and new)');
    const aPng = await audit(png.body.data.id);
    ok(aPng.at(-1).action === 'document.deleted' && aPng.at(-1).old_data.title === `png ${tag}` && aPng.at(-1).old_data.file_name === 'p.png', 'audit: deleted with what it was');
    const log = await call(A, 'GET', '/accounts/audit?action=document.updated&limit=5');
    ok(log.status === 200 && log.body.data.entries?.some((e) => e.target_id === AM.id && e.target_label === `ልደት ${tag}`), 'audit log viewer labels the document with its title', msg(log));
  } finally {
    const ids = made.filter(Boolean);
    const { rows } = await pool.query('DELETE FROM documents WHERE id = ANY($1::uuid[]) RETURNING file_path', [ids]);
    for (const r of rows) if (fs.existsSync(r.file_path) && path.dirname(path.resolve(r.file_path)) === path.resolve(UPLOADS)) fs.unlinkSync(r.file_path);
    await pool.end();
  }
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`PASS=${pass} FAIL=${fail + 1}`); process.exit(1); });
