// Before/after check for the M5a migrations together (020 semesters, 021 results, 022 conduct /
// promotion decisions / locks), for tests/restore_check.sh, which applies all pending
// migrations in one go:   bash tests/restore_check.sh m5a tests/check_m5a.js
//   before: the dry runs of 020 (exam lists) and 021
//   after:  020 and 021 after-checks, and the three new 022 tables exist and are empty
// Read-only. Refuses any database but asms_restore_check / asms_phase0_test.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { spawnSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');
const DB = process.env.DB_NAME;
if (!['asms_restore_check', 'asms_phase0_test'].includes(DB)) { console.error('[check_m5a] ABORT: DB_NAME is', DB); process.exit(1); }
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) { console.error('usage: node tests/check_m5a.js before|after'); process.exit(1); }

let bad = 0;
for (const script of ['check_020.js', 'check_021.js']) {
  console.log(`-- ${script} ${phase}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script), phase], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) bad++;
}

(async () => {
  if (phase === 'after') {
    console.log('-- 022');
    const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB });
    await c.connect();
    for (const t of ['semester_conduct', 'promotion_decisions', 'semester_locks']) {
      const exists = (await c.query('SELECT to_regclass($1) IS NOT NULL AS e', [`public.${t}`])).rows[0].e;
      const n = exists ? (await c.query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n : null;
      console.log(`  ${t.padEnd(20)} ${exists ? `exists, ${n} row(s)` : 'MISSING'}`);
      if (!exists || n) bad++;
    }
    const last = (await c.query('SELECT MAX(filename) f FROM _migrations')).rows[0].f;
    console.log(`  last migration: ${last}`);
    if (last !== '022_conduct_promotion_locks.sql') bad++;
    await c.end();
  }
  console.log(`[check_m5a] ${phase}: ${bad ? 'FAILED' : 'OK'}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
