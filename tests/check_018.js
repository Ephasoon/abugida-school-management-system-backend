// Before/after check for migration 018 (Amharic names) on asms_restore_check.
// Usage (through tests/restore_check.sh): node tests/check_018.js before|after
// "before" saves row counts and a checksum of every existing column of students,
// teachers and parents; "after" checks they are unchanged and the six new columns
// exist and are empty. Refuses any database but asms_restore_check.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const NAME = 'asms_restore_check';
if (process.env.DB_NAME !== NAME) { console.error('[check_018] ABORT: DB_NAME is', process.env.DB_NAME); process.exit(1); }
const phase = process.argv[2];
const SAVED = path.join(require('os').tmpdir(), 'asms_check_018.json');
const TABLES = { students: [], teachers: [], parents: [] };
const NEW = { students: ['first_name_am', 'fathers_name_am', 'last_name_am'], teachers: ['first_name_am', 'last_name_am'], parents: ['full_name_am'] };

(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: NAME });
  await c.connect();
  const before = phase === 'after' ? JSON.parse(fs.readFileSync(SAVED, 'utf8')) : null;
  const now = {};
  let bad = 0;
  for (const t of Object.keys(TABLES)) {
    // The columns that existed before 018, in a stable order
    const cols = before ? before[t].cols : (await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t])).rows.map(r => r.column_name);
    const list = cols.map(x => `"${x}"`).join(', ');
    const { rows } = await c.query(
      `SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5(ROW(${list})::text), '' ORDER BY id)), '-') AS sum FROM ${t}`);
    now[t] = { cols, n: rows[0].n, sum: rows[0].sum };
    const am = (await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2)`, [t, NEW[t]])).rows.length;
    if (!before) {
      console.log(`  ${t.padEnd(9)} rows ${String(rows[0].n).padStart(5)}  existing columns ${cols.length}  Amharic columns ${am}/${NEW[t].length}`);
      if (am) { console.log(`  ! ${t} already has Amharic columns`); bad++; }
      continue;
    }
    const filled = (await c.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE ${NEW[t].map(x => `${x} IS NOT NULL`).join(' OR ')}`)).rows[0].n;
    const same = before[t].n === rows[0].n && before[t].sum === rows[0].sum;
    console.log(`  ${t.padEnd(9)} rows ${before[t].n} -> ${rows[0].n}  existing data ${same ? 'unchanged' : 'CHANGED'}  Amharic columns ${am}/${NEW[t].length}, non-empty ${filled}`);
    if (!same || am !== NEW[t].length || filled) bad++;
  }
  const mig = (await c.query("SELECT COUNT(*)::int AS n FROM _migrations WHERE filename = '018_amharic_names.sql'")).rows[0].n;
  console.log(`  _migrations has 018_amharic_names.sql: ${mig ? 'yes' : 'no'}`);
  if (phase === 'after' && !mig) bad++;
  if (!before) fs.writeFileSync(SAVED, JSON.stringify(now));
  await c.end();
  console.log(bad ? `[check_018] ${phase}: ${bad} problem(s)` : `[check_018] ${phase}: OK`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
