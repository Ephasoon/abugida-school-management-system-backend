// Phase 2 M5a (D): the report card PDF from the results service: both semesters and the year,
// scores out of 100 (no GPA or letters), totals, averages, "Rank 1 of 2", class size and not
// ranked, days absent per semester, conduct and the homeroom remark, promotion (year only),
// Final / Provisional per semester, Amharic names and Ethiopian dates (the text is extracted
// from the PDF). Scratch DB backend on :3100.
const pool = require('./tdb');
const { createFreeYear } = require('./years');
const { formatEthiopian, academicYearEthiopian } = require('../src/utils/ethiopianDate');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call(null, 'POST', '/auth/login', { email: e, password: p })).body?.data?.accessToken;
const pdf = async (tok, p) => {
  const r = await fetch(API + p, { headers: { Authorization: `Bearer ${tok}` } });
  return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) };
};
async function pdfText(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, verbosity: 0 }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join(' ') + '\n';
  await doc.destroy();
  return text.replace(/\s+/g, ' ');
}
const tag = Date.now().toString(36);

(async () => {
  console.log('[g29] db =', (await pool.query('select current_database() d')).rows[0].d);
  const A = await login('admin@asms.et', 'Admin@1234');
  const G = require('./g3.json');
  const PA = await login(G.parent.email, 'Pass#2026');
  const yr = (await createFreeYear(call, A, 6000, 7000)).body.data;
  const cls = (await call(A, 'POST', '/classes', { academic_year_id: yr.id, grade_level: 8, section: 'B' })).body.data.id;
  let lockId = null;
  try {
    const stu = async (first, more = {}) => (await call(A, 'POST', '/students', { first_name: first, last_name: `G29${tag}`, gender: 'female', class_id: cls, ...more })).body.data.id;
    const hana = await stu('Hana', { fathers_name: 'Tesfaye', first_name_am: 'ሐና', fathers_name_am: 'ተስፋዬ' });
    const lily = await stu('Lily');
    const part = await stu('Part');
    const ex = async (subject, sem, max) => (await call(A, 'POST', '/grades/exams', { class_id: cls, subject_id: subject, name: `G29 ${tag}`, exam_type: 'final', max_score: max, semester: sem })).body.data.id;
    const m1 = await ex(G.math, 1, 100), e1 = await ex(G.eng, 1, 100), m2 = await ex(G.math, 2, 100), e2 = await ex(G.eng, 2, 100);
    const enter = (exam, list) => call(A, 'POST', '/grades', { exam_id: exam, grades: list.map(([student_id, score]) => ({ student_id, score })) });
    await enter(m1, [[hana, 92], [lily, 70], [part, 50]]);
    await enter(e1, [[hana, 88], [lily, 60]]);
    await enter(m2, [[hana, 80], [lily, 66]]);
    await enter(e2, [[hana, 84], [lily, 64]]);
    await call(A, 'PUT', `/results/class/${cls}/conduct`, { semester: 1, entries: [{ student_id: hana, conduct: 'A', remark: 'በጣም ጎበዝ ናት' }] });
    const d = new Date(`${yr.start_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 15);
    await pool.query("INSERT INTO attendance (student_id, class_id, date, status) VALUES ($1, $2, $3, 'absent')", [hana, cls, d.toISOString().slice(0, 10)]);
    lockId = (await call(A, 'POST', '/results/locks', { academic_year_id: yr.id, semester: 1, class_id: cls })).body?.data?.id;

    console.log('== Hana: complete, both semesters');
    const r = await pdf(A, `/pdf/report-card/${hana}?academic_year_id=${yr.id}`);
    ok(r.status === 200 && r.type === 'application/pdf' && r.buf.slice(0, 5).toString() === '%PDF-', 'a PDF');
    const t = await pdfText(r.buf);
    ok(t.includes(`Hana Tesfaye G29${tag}`) && t.includes('ሐና ተስፋዬ'), 'Latin name with the father\'s name, and the Amharic name');
    ok(t.includes('STUDENT REPORT CARD') && t.includes('የተማሪ ውጤት መግለጫ'), 'title in English and Amharic');
    ok(t.includes(`${academicYearEthiopian(yr.end_date)} E.C. (${yr.name})`), 'academic year in both forms');
    ok(t.includes(`Generated: ${formatEthiopian(new Date())}`), 'Ethiopian "Generated" date');
    ok(/Mathematics .*92\.0 .*80\.0 .*86\.0/.test(t), 'Mathematics: 92.0, 80.0, year 86.0', t.slice(t.indexOf('Mathematics'), t.indexOf('Mathematics') + 60));
    ok(/Average 90\.00 82\.00 86\.00/.test(t), 'averages 90.00, 82.00, year 86.00');
    ok(/Rank 1 of 2 1 of 2 1 of 2/.test(t), 'rank 1 of 2 in each semester and the year');
    ok(/Days absent · የቀሩበት ቀን 1 0 1/.test(t), 'days absent: 1 in semester 1');
    ok(/Conduct · ጠባይ A —/.test(t) && t.includes('በጣም ጎበዝ ናት'), 'conduct A and the Amharic homeroom remark');
    ok(t.includes('Promoted · ተዛውሯል'), 'Promoted (yearly average 86 >= 50)');
    ok(t.includes('Semester 1: Final · Semester 2: Provisional'), 'semester 1 locked: Final; semester 2 Provisional');
    ok(t.includes('Class: 3 students, 1 not ranked'), 'class size and the number not ranked');
    ok(!/GPA|\bA\+|Grade points/.test(t), 'no GPA, no letter grades');

    console.log('== Part: incomplete');
    const p = await pdfText((await pdf(A, `/pdf/report-card/${part}?academic_year_id=${yr.id}`)).buf);
    ok(/Mathematics .*50\.0 .*—/.test(p) && /English .*— /.test(p), 'scores entered so far, dashes where missing');
    ok(/Rank not ranked not ranked not ranked/.test(p) && !p.includes('Promoted'), 'not ranked, no promotion shown');

    console.log('== Yearly score incomplete unless both semesters are complete');
    // Own class: Mathematics has one 20-point test in semester 1 (scored) and nothing in
    // semester 2; English has a semester 1 exam without a score
    const cls2 = (await call(A, 'POST', '/classes', { academic_year_id: yr.id, grade_level: 8, section: 'C' })).body.data.id;
    const semi = (await call(A, 'POST', '/students', { first_name: 'Semi', last_name: `G29${tag}`, gender: 'male', class_id: cls2 })).body.data.id;
    const q1 = (await call(A, 'POST', '/grades/exams', { class_id: cls2, subject_id: G.math, name: `G29 test ${tag}`, exam_type: 'quiz', max_score: 20, semester: 1 })).body.data.id;
    await call(A, 'POST', '/grades/exams', { class_id: cls2, subject_id: G.eng, name: `G29 ${tag}`, exam_type: 'final', max_score: 100, semester: 1 });
    await enter(q1, [[semi, 18]]);
    const sr = (await call(A, 'GET', `/results/student/${semi}?academic_year_id=${yr.id}`)).body?.data;
    const ys = (id) => sr?.year.subjects.find((x) => x.subject_id === id);
    ok(ys(G.math)?.score === 18 && ys(G.math)?.complete === false, 'API: Mathematics yearly 18, not complete (semester 1 incomplete, no semester 2)', JSON.stringify(ys(G.math)));
    ok(ys(G.eng)?.score === null && ys(G.eng)?.complete === false, 'API: English yearly null (no scores)', JSON.stringify(ys(G.eng)));
    const cy = (await call(A, 'GET', `/results/class/${cls2}?semester=year`)).body?.data?.students.find((x) => x.student_id === semi);
    ok(cy?.yearly_subjects[G.math] === 18 && cy?.yearly_subjects_complete[G.math] === false, 'API: class year sheet marks it incomplete too');
    const yh = (await call(A, 'GET', `/results/student/${hana}?academic_year_id=${yr.id}`)).body?.data?.year.subjects.find((x) => x.subject_id === G.math);
    ok(yh?.score === 86 && yh?.complete === true, 'API: complete in both semesters -> yearly complete (Hana 86)');
    const ts = await pdfText((await pdf(A, `/pdf/report-card/${semi}?academic_year_id=${yr.id}`)).buf);
    ok(/Mathematics[^\d—]* 18\.0 \* — 18\.0 \*/.test(ts), 'PDF: Mathematics "18.0 *", "—", year "18.0 *"', ts.slice(ts.indexOf('Mathematics'), ts.indexOf('Mathematics') + 40));
    ok(/English[^\d—]* — — —/.test(ts), 'PDF: English without scores: "—" in every column including the year');
    ok(/Total 18\.0 — —/.test(ts), 'PDF: Total "—" for semester 2 and the year', ts.slice(ts.indexOf('Total'), ts.indexOf('Total') + 30));
    ok(/Mathematics .*86\.0 /.test(t) && !/Mathematics 92\.0 80\.0 86\.0 \*/.test(t) && /Total 180\.0 164\.0 —/.test(t), 'PDF: Hana\'s complete yearly score has no "*"; Total year "—"');
    await call(A, 'DELETE', `/students/${semi}`);

    console.log('== No results; old query; bad input; scoping');
    const lone = (await call(A, 'POST', '/students', { first_name: 'Lone', last_name: `G29${tag}`, gender: 'male' })).body.data.id;
    const n = await pdf(A, `/pdf/report-card/${lone}`);
    ok(n.status === 200 && (await pdfText(n.buf)).includes('No results yet'), 'a student without class or scores: "No results yet"');
    ok((await pdf(A, `/pdf/report-card/${hana}?term=term1`)).status === 200, 'old ?term=term1 still works');
    ok((await pdf(A, `/pdf/report-card/${hana}?semester=3`)).status === 400, '?semester=3 -> 400');
    ok((await pdf(A, `/pdf/report-card/${hana}?academic_year_id=x`)).status === 400, 'academic_year_id malformed -> 400');
    ok((await pdf(PA, `/pdf/report-card/${hana}`)).status === 403, "parent: someone else's child -> 403");
    for (const id of [hana, lily, part, lone]) await call(A, 'DELETE', `/students/${id}`);
  } finally {
    if (lockId) await call(A, 'DELETE', `/results/locks/${lockId}`);
  }
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
