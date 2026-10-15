// Dry run and before/after check for migration 021 (results: no letters, school settings)
// on asms_restore_check (also asms_phase0_test). Usage (through tests/restore_check.sh):
//   node tests/check_021.js before   grades and letters today, what 021 changes; saves checksums
//   node tests/check_021.js after    grades unchanged (letters kept, no longer filled), the score
//                                    check still refuses a score above max_score, settings seeded
// Read-only, except one rolled-back test insert in "after". Refuses any other database.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const DB = process.env.DB_NAME;
if (!['asms_restore_check', 'asms_phase0_test'].includes(DB)) { console.error('[check_021] ABORT: DB_NAME is', DB); process.exit(1); }
const phase = process.argv[2];
const SAVED = path.join(require('os').tmpdir(), `asms_check_021_${DB}.json`);
const TABLES = ['grades', 'exams', 'students'];

(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB });
  await c.connect();
  if ((await c.query('SELECT current_database() d')).rows[0].d !== DB) process.exit(1);
  let bad = 0;
  const sums = {};
  // exams: the columns that exist before and after 020 (020 adds `semester` when both run together)
  const ROW = { exams: "x.id, x.class_id, x.subject_id, x.name, x.max_score, x.exam_date, x.term" };
  for (const t of TABLES) {
    sums[t] = (await c.query(`SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5((${ROW[t] ? `ROW(${ROW[t]})` : 'x'})::text), '' ORDER BY x.id)), '-') AS sum FROM ${t} x`)).rows[0];
  }
  const letters = (await c.query('SELECT COUNT(*)::int n, COUNT(grade_letter)::int l FROM grades')).rows[0];

  if (phase === 'before') {
    if ((await c.query("SELECT to_regclass('public.school_settings') IS NOT NULL AS e")).rows[0].e) { console.error('  021 already applied here'); process.exit(1); }
    console.log(`  grades: ${letters.n} (${letters.l} with a letter: kept as they are, no new letters)`);
    console.log("  trigger trg_set_grade_letter -> trg_check_grade_score (same max-score check, no letter)");
    console.log('  new table school_settings: pass_yearly_average = 50, manual_promotion_grades = []');
    fs.writeFileSync(SAVED, JSON.stringify({ sums, letters }));
  } else if (phase === 'after') {
    const saved = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    for (const t of TABLES) {
      const same = saved.sums[t].n === sums[t].n && saved.sums[t].sum === sums[t].sum;
      console.log(`  ${t.padEnd(9)} rows ${saved.sums[t].n} -> ${sums[t].n}  ${same ? 'unchanged' : 'CHANGED'}`);
      if (!same) bad++;
    }
    const trig = (await c.query("SELECT tgname FROM pg_trigger WHERE tgrelid = 'grades'::regclass AND NOT tgisinternal ORDER BY 1")).rows.map((r) => r.tgname).join(', ');
    console.log(`  grades triggers: ${trig}`);
    if (!/trg_check_grade_score/.test(trig) || /trg_set_grade_letter/.test(trig)) bad++;
    const fn = (await c.query("SELECT COUNT(*)::int n FROM pg_proc WHERE proname IN ('calculate_grade_letter', 'set_grade_letter')")).rows[0].n;
    console.log(`  letter functions left: ${fn}`);
    if (fn) bad++;
    const settings = (await c.query('SELECT key, value FROM school_settings ORDER BY key')).rows;
    console.log(`  school_settings: ${settings.map((s) => `${s.key} = ${JSON.stringify(s.value)}`).join(', ')}`);
    if (settings.length !== 2) bad++;
    // The max-score check still works (inside a transaction that is rolled back)
    const g = (await c.query('SELECT g.exam_id, g.student_id, e.max_score FROM grades g JOIN exams e ON e.id = g.exam_id LIMIT 1')).rows[0];
    if (g) {
      await c.query('BEGIN');
      let refused = false;
      try { await c.query('UPDATE grades SET score = $1 WHERE exam_id = $2 AND student_id = $3', [Number(g.max_score) + 1, g.exam_id, g.student_id]); } catch (e) { refused = e.code === '23514'; }
      await c.query('ROLLBACK');
      console.log(`  a score above max_score is refused: ${refused ? 'yes' : 'NO'}`);
      if (!refused) bad++;
    }
  } else {
    console.error('usage: node tests/check_021.js before|after'); process.exit(1);
  }
  await c.end();
  console.log(`[check_021] ${phase}: ${bad ? 'FAILED' : 'OK'}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
