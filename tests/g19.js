// Phase 2 G9: Amharic text and Ethiopian dates in PDFs.
//   1. src/utils/ethiopianDate.js against the shared test vectors (the same file as the web app's
//      converter: tests/fixtures/ethiopian-dates.json must equal asms-web/test-vectors/ethiopian-dates.json)
//   2. Student and teacher ID cards: the text extracted from the PDF (pdfjs-dist) has the Amharic
//      name, the Amharic school name and Ethiopian dates; the font is embedded (Noto Sans Ethiopic);
//      no Helvetica left. The report card still renders.
// Scratch DB backend on :3100. Run via guard.sh.
const fs = require('fs');
const path = require('path');
const pool = require('./tdb');
const G = require('./g3.json');
const { toEthiopian, formatEthiopian } = require('../src/utils/ethiopianDate');
const API = 'http://localhost:3100/api';
let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const call = async (tok, method, p, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const pdf = async (tok, p) => {
  const r = await fetch(API + p, { headers: { Authorization: `Bearer ${tok}` } });
  return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) };
};
const tag = Date.now().toString(36);

// Text of every page, and the font names used
async function pdfText(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, verbosity: 0 }).promise;
  let text = '';
  const fonts = new Set();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(' ') + '\n';
    for (const st of Object.values(content.styles)) fonts.add(st.fontFamily);
  }
  await doc.destroy();
  return { text: text.replace(/\s+/g, ' '), raw: buf.toString('latin1') };
}

(async () => {
  console.log('[g19] db =', (await pool.query('select current_database() d')).rows[0].d);

  console.log('== Ethiopian date converter (shared vectors)');
  const vectorsFile = path.join(__dirname, 'fixtures', 'ethiopian-dates.json');
  const webFile = path.join(process.env.WEB_DIR || path.join(__dirname, '..', '..', 'asms-web'), 'test-vectors', 'ethiopian-dates.json');
  if (fs.existsSync(webFile)) {
    ok(fs.readFileSync(webFile, 'utf8').replace(/\r\n/g, '\n') === fs.readFileSync(vectorsFile, 'utf8').replace(/\r\n/g, '\n'),
      'the backend copy of the vectors equals the web app\'s file');
  } else console.log('  (asms-web not found: vectors file not compared)');
  const { vectors } = JSON.parse(fs.readFileSync(vectorsFile, 'utf8'));
  let bad = vectors.filter((v) => { const e = toEthiopian(v.gregorian); return !e || [e.year, e.month, e.day].join() !== v.ethiopian.join(); });
  ok(bad.length === 0, `all ${vectors.length} vectors`, bad.map((v) => v.gregorian).join(' '));
  // Every day 1900-2100: consecutive, months of 30 days, Pagume 5 or 6 (6 when year mod 4 = 3)
  let prev = null, broken = 0;
  for (let t = Date.UTC(1900, 0, 1); t <= Date.UTC(2100, 11, 31); t += 86400000) {
    const e = toEthiopian(new Date(t).toISOString().slice(0, 10));
    if (prev) {
      const last = prev.month < 13 ? 30 : (prev.year % 4 === 3 ? 6 : 5);
      const next = prev.day < last ? [prev.year, prev.month, prev.day + 1] : prev.month < 13 ? [prev.year, prev.month + 1, 1] : [prev.year + 1, 1, 1];
      if ([e.year, e.month, e.day].join() !== next.join()) broken++;
    }
    prev = e;
  }
  ok(broken === 0, 'every day 1900-2100 follows the previous one (month lengths, Pagume 5/6)', `${broken} breaks`);
  ok(formatEthiopian('2026-10-14') === 'Tikimt 4, 2019 E.C.' && formatEthiopian('2026-10-14', 'am') === 'ጥቅምት 4 2019 ዓ.ም.' && formatEthiopian(null) === '',
    'formatEthiopian in English and Amharic');

  const A = await login();
  async function login() { return (await call(null, 'POST', '/auth/login', { email: 'admin@asms.et', password: 'Admin@1234' })).body?.data?.accessToken; }

  console.log('== Student ID card');
  const s = (await call(A, 'POST', '/students', {
    first_name: 'Hanna', last_name: `G19${tag}`, fathers_name: 'Tesfaye', gender: 'female', class_id: G.c9A, date_of_birth: '2012-09-11',
    first_name_am: 'ሐና', fathers_name_am: 'ተስፋዬ', last_name_am: 'ገብሬ',
  })).body.data;
  const card = await pdf(A, `/pdf/student-id/${s.id}`);
  ok(card.status === 200 && card.type === 'application/pdf' && card.buf.slice(0, 5).toString() === '%PDF-', 'a PDF', `${card.status} ${card.type}`);
  const st = await pdfText(card.buf);
  ok(st.text.includes('ሐና ተስፋዬ ገብሬ'), 'the Amharic name is in the text (extracted, not boxes)', st.text.slice(0, 160));
  ok(st.text.includes(`Hanna G19${tag}`), 'the Latin name too');
  const schoolAm = process.env.SCHOOL_NAME_AM || (process.env.SCHOOL_NAME ? '' : 'አቡጊዳ ትምህርት ቤት');
  ok(st.text.includes('የተማሪ መታወቂያ') && (schoolAm ? st.text.includes(schoolAm) : !st.text.includes('አቡጊዳ')), schoolAm ? 'Amharic school name and card title' : 'card title in Amharic; no Amharic school name (SCHOOL_NAME set, SCHOOL_NAME_AM not)');
  ok(st.text.includes('Born: Meskerem 1, 2005 E.C.'), 'date of birth in the Ethiopian calendar (2012-09-11 = Meskerem 1, 2005)');
  ok(st.text.includes(`Issued ${formatEthiopian(new Date())}`), 'issue date in the Ethiopian calendar');
  const year = (await pool.query('SELECT ay.start_date, ay.end_date, ay.name FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id WHERE c.id = $1', [G.c9A])).rows[0];
  ok(st.text.includes(`Year: ${toEthiopian(year.start_date).year} E.C. (${year.name})`), 'academic year in both forms');
  ok(st.text.includes(`Valid until ${formatEthiopian(year.end_date)}`), 'valid until the end of the academic year (Ethiopian)');
  ok(/FontName\s*\/[A-Z]{6}\+NotoSansEthiopic/.test(st.raw), 'Noto Sans Ethiopic is embedded (subset)');
  ok(!/Helvetica/.test(st.raw), 'no Helvetica left');

  const plain = (await call(A, 'POST', '/students', { first_name: 'Plain', last_name: `G19${tag}`, gender: 'male', class_id: G.c9A })).body.data;
  const pt = await pdfText((await pdf(A, `/pdf/student-id/${plain.id}`)).buf);
  ok(pt.text.includes(`Plain G19${tag}`) && !pt.text.includes('Born:'), 'without Amharic name or birth date: still a card, those lines left out');

  console.log('== Teacher ID card');
  const t = (await call(A, 'POST', '/teachers', { first_name: 'Dawit', last_name: `G19${tag}`, email: `g19_${tag}@asms.et`, first_name_am: 'ዳዊት', last_name_am: 'አለማየሁ', hire_date: '2025-09-11' })).body.data;
  const tt = await pdfText((await pdf(A, `/pdf/teacher-id/${t.id}`)).buf);
  ok(tt.text.includes('ዳዊት አለማየሁ') && tt.text.includes('የሠራተኛ መታወቂያ'), 'teacher card: Amharic name and title');
  ok(tt.text.includes('Since: Meskerem 1, 2018 E.C.'), 'hire date in the Ethiopian calendar');

  console.log('== Report card still renders');
  const rc = await pdf(A, `/pdf/report-card/${G.s1.sid}`);
  const rt = await pdfText(rc.buf);
  ok(rc.status === 200 && /Generated: \w+ \d+, \d{4} E\.C\./.test(rt.text) && !/Helvetica/.test(rt.raw), 'report card: a PDF, Ethiopian "Generated" date, embedded font');

  console.log('== Access unchanged');
  const P = (await call(null, 'POST', '/auth/login', { email: 'principal.g7@asms.et', password: 'Pass#2026' })).body?.data?.accessToken;
  ok((await pdf(P, `/pdf/student-id/${s.id}`)).status === 403, 'principal -> 403 (admin only)');

  for (const id of [s.id, plain.id]) await call(A, 'DELETE', `/students/${id}`);
  await call(A, 'PUT', `/teachers/${t.id}`, { is_active: false });
  await pool.end();
  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
