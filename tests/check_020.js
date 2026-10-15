// Dry run and before/after check for migration 020 (semesters) on asms_restore_check
// (also usable on asms_phase0_test). Usage (through tests/restore_check.sh):
//   node tests/check_020.js before   prints what 020 will do: exams per term and date, the
//                                    semester each would get, term/date disagreements, exams
//                                    dated outside their year, term3 exams, years whose
//                                    default semester 2 start falls outside, and subjects whose
//                                    max scores would total over 100 per semester; saves checksums
//   node tests/check_020.js after    checks every exam got the predicted semester and that
//                                    grades, classes and students are unchanged
// Read-only. Refuses any other database.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const DB = process.env.DB_NAME;
if (!['asms_restore_check', 'asms_phase0_test'].includes(DB)) { console.error('[check_020] ABORT: DB_NAME is', DB); process.exit(1); }
const phase = process.argv[2];
const SAVED = path.join(require('os').tmpdir(), `asms_check_020_${DB}.json`);
const TABLES = ['grades', 'classes', 'students'];

// The same rules as the migration, written out so "before" works without its functions
const ETH_YEAR = (d) => `(4 * ((to_char(${d}, 'J')::int - 1723856) / 1461) + ((to_char(${d}, 'J')::int - 1723856) % 1461) / 365 - ((to_char(${d}, 'J')::int - 1723856) % 1461) / 1460)`;
const YEKATIT1 = (end) => `to_date((1723856 + 365 + 365 * (${ETH_YEAR(end)} - 1) + ${ETH_YEAR(end)} / 4 + 150)::text, 'J')`;
const S2 = `CASE WHEN ${YEKATIT1('y.end_date')} > y.start_date AND ${YEKATIT1('y.end_date')} <= y.end_date
  THEN ${YEKATIT1('y.end_date')} ELSE y.start_date + ((y.end_date - y.start_date) / 2) END`;
const PREDICT = `
  SELECT e.id, e.name, e.term::text, e.exam_date::text, e.max_score, c.name AS class, s.name AS subject,
         e.class_id, e.subject_id, y.name AS year, y.start_date::text AS y_start, y.end_date::text AS y_end,
         (${S2})::text AS s2,
         (e.exam_date IS NOT NULL AND e.exam_date BETWEEN y.start_date AND y.end_date) AS dated_inside,
         CASE WHEN e.exam_date IS NOT NULL AND e.exam_date BETWEEN y.start_date AND y.end_date
                THEN CASE WHEN e.exam_date >= (${S2}) THEN 'semester2' ELSE 'semester1' END
              WHEN e.term = 'term1' THEN 'semester1' ELSE 'semester2' END AS semester,
         CASE WHEN e.term = 'term1' THEN 'semester1' ELSE 'semester2' END AS by_term
  FROM exams e JOIN classes c ON c.id = e.class_id JOIN academic_years y ON y.id = c.academic_year_id
  JOIN subjects s ON s.id = e.subject_id`;

(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB });
  await c.connect();
  if ((await c.query('SELECT current_database() d')).rows[0].d !== DB) process.exit(1);
  let bad = 0;
  const sums = {};
  for (const t of TABLES) {
    sums[t] = (await c.query(`SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5(x::text), '' ORDER BY x.id)), '-') AS sum FROM ${t} x`)).rows[0];
  }

  if (phase === 'before') {
    if ((await c.query("SELECT to_regtype('semester_type') IS NOT NULL AS e")).rows[0].e) { console.error('  020 already applied here'); process.exit(1); }
    const ex = (await c.query(`${PREDICT} ORDER BY y.start_date, c.grade_level, c.section, s.name, e.exam_date NULLS FIRST`)).rows;
    console.log(`  exams: ${ex.length}`);
    const by = {};
    for (const e of ex) { const k = `${e.term}, ${e.exam_date ? 'dated' : 'no date'} -> ${e.semester}`; by[k] = (by[k] || 0) + 1; }
    for (const [k, n] of Object.entries(by).sort()) console.log(`    ${k.padEnd(34)} ${n}`);
    const years = (await c.query(`SELECT y.name, y.start_date::text s, y.end_date::text e, (${S2})::text s2, (${YEKATIT1('y.end_date')})::text yek FROM academic_years y ORDER BY y.start_date`)).rows;
    console.log('  academic years -> semester 2 starts');
    for (const y of years) console.log(`    ${y.name}  ${y.s} .. ${y.e}  -> ${y.s2}${y.s2 !== y.yek ? `  (Yekatit 1 = ${y.yek} is outside the year: middle used, CHECK)` : ''}`);
    const list = (title, rows, fmt) => { console.log(`  ${title}: ${rows.length}`); for (const r of rows) console.log(`    - ${fmt(r)}`); };
    const line = (e) => `${e.year} ${e.class} ${e.subject}: "${e.name}" ${e.term}${e.exam_date ? ` ${e.exam_date}` : ' (no date)'}`;
    list('term/date disagreements (date decides)', ex.filter((e) => e.dated_inside && e.semester !== e.by_term), (e) => `${line(e)} -> ${e.semester} (term says ${e.by_term})`);
    list('exams dated outside their year (term decides)', ex.filter((e) => e.exam_date && !e.dated_inside), (e) => `${line(e)}, year ${e.y_start}..${e.y_end} -> ${e.semester}`);
    list('term3 exams', ex.filter((e) => e.term === 'term3'), (e) => `${line(e)} -> ${e.semester}`);
    const groups = {};
    for (const e of ex) {
      const k = `${e.year} ${e.class} ${e.subject}, ${e.semester}`;
      (groups[k] ||= { total: 0, parts: [] }).total += Number(e.max_score);
      groups[k].parts.push(`${e.name} ${Number(e.max_score)}`);
    }
    list('subjects whose max scores total over 100 in a semester (left as they are, shown as "check")',
      Object.entries(groups).filter(([, g]) => g.total > 100), ([k, g]) => `${k}: ${g.total} (${g.parts.join(' + ')})`);
    fs.writeFileSync(SAVED, JSON.stringify({ sums, predicted: Object.fromEntries(ex.map((e) => [e.id, e.semester])) }));
  } else if (phase === 'after') {
    const saved = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    for (const t of TABLES) {
      const same = saved.sums[t].n === sums[t].n && saved.sums[t].sum === sums[t].sum;
      console.log(`  ${t.padEnd(10)} rows ${saved.sums[t].n} -> ${sums[t].n}  ${same ? 'unchanged' : 'CHANGED'}`);
      if (!same) bad++;
    }
    const got = (await c.query('SELECT id, semester::text FROM exams')).rows;
    const wrong = got.filter((e) => saved.predicted[e.id] !== e.semester);
    console.log(`  exams with the predicted semester: ${got.length - wrong.length} of ${got.length}${wrong.length ? `  MISMATCH ${wrong.map((w) => w.id).join(', ')}` : ''}`);
    if (wrong.length || got.length !== Object.keys(saved.predicted).length) bad++;
    const nulls = (await c.query('SELECT COUNT(*)::int n FROM academic_years WHERE semester2_start IS NULL')).rows[0].n;
    console.log(`  academic years without semester2_start: ${nulls}`);
    if (nulls) bad++;
    const fn = (await c.query("SELECT asms_semester2_default('2027-07-31')::text d")).rows[0].d;
    console.log(`  asms_semester2_default(2027-07-31) = ${fn} (2019 E.C. Yekatit 1: 2027-02-08)`);
    if (fn !== '2027-02-08') bad++;
  } else {
    console.error('usage: node tests/check_020.js before|after'); process.exit(1);
  }
  await c.end();
  console.log(`[check_020] ${phase}: ${bad ? 'FAILED' : 'OK'}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
