// Before/after check for migration 019 (promotion_runs) on asms_restore_check.
// Usage (through tests/restore_check.sh): node tests/check_019.js before|after
// "before" saves row counts and a checksum of academic_years, classes and students
// and checks promotion_runs does not exist; "after" checks they are unchanged and
// promotion_runs exists and is empty. Refuses any database but asms_restore_check.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const NAME = 'asms_restore_check';
if (process.env.DB_NAME !== NAME) { console.error('[check_019] ABORT: DB_NAME is', process.env.DB_NAME); process.exit(1); }
const phase = process.argv[2];
const SAVED = path.join(require('os').tmpdir(), 'asms_check_019.json');
const TABLES = ['academic_years', 'classes', 'students'];

(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: NAME });
  await c.connect();
  const before = phase === 'after' ? JSON.parse(fs.readFileSync(SAVED, 'utf8')) : null;
  const now = {};
  let bad = 0;
  for (const t of TABLES) {
    const { rows } = await c.query(`SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5(x::text), '' ORDER BY x.id)), '-') AS sum FROM ${t} x`);
    now[t] = rows[0];
    if (!before) { console.log(`  ${t.padEnd(15)} rows ${String(rows[0].n).padStart(5)}`); continue; }
    const same = before[t].n === rows[0].n && before[t].sum === rows[0].sum;
    console.log(`  ${t.padEnd(15)} rows ${before[t].n} -> ${rows[0].n}  ${same ? 'unchanged' : 'CHANGED'}`);
    if (!same) bad++;
  }
  const exists = (await c.query("SELECT to_regclass('public.promotion_runs') IS NOT NULL AS e")).rows[0].e;
  const rows = exists ? (await c.query('SELECT COUNT(*)::int n FROM promotion_runs')).rows[0].n : null;
  console.log(`  promotion_runs: ${exists ? `exists, ${rows} row(s)` : 'does not exist'}`);
  if (phase === 'before' && exists) bad++;
  if (phase === 'after' && (!exists || rows !== 0)) bad++;
  const mig = (await c.query("SELECT COUNT(*)::int AS n FROM _migrations WHERE filename = '019_promotion_runs.sql'")).rows[0].n;
  console.log(`  _migrations has 019_promotion_runs.sql: ${mig ? 'yes' : 'no'}`);
  if (phase === 'after' && !mig) bad++;
  if (!before) fs.writeFileSync(SAVED, JSON.stringify(now));
  await c.end();
  console.log(bad ? `[check_019] ${phase}: ${bad} problem(s)` : `[check_019] ${phase}: OK`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
