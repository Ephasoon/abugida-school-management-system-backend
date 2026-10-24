// Dry run and before/after check for migration 023 (subject status, period times, audit index)
// on asms_restore_check (also asms_phase0_test). Usage (through tests/restore_check.sh):
//   node tests/check_023.js before   subjects and their codes (codes the new edit rules would refuse,
//                                    codes equal ignoring case), usage, timetable slots and their
//                                    times, teacher double bookings in one year, audit log size; checksums
//   node tests/check_023.js after    subjects, timetable, audit log and the other settings unchanged,
//                                    every subject active, period_times seeded (8 periods), index there
// Read-only. Refuses any other database.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const DB = process.env.DB_NAME;
if (!['asms_restore_check', 'asms_phase0_test'].includes(DB)) { console.error('[check_023] ABORT: DB_NAME is', DB); process.exit(1); }
const phase = process.argv[2];
const SAVED = path.join(require('os').tmpdir(), `asms_check_023_${DB}.json`);
// The columns that exist before and after 023
const ROW = {
  subjects: 'x.id, x.name, x.name_am, x.code, x.grade_level, x.created_at',
  timetable: 'x.*',
  audit_logs: 'x.*',
};

(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB });
  await c.connect();
  if ((await c.query('SELECT current_database() d')).rows[0].d !== DB) process.exit(1);
  let bad = 0;
  const sums = {};
  for (const t of ['subjects', 'timetable', 'audit_logs']) {
    sums[t] = (await c.query(`SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5(ROW(${ROW[t]})::text), '' ORDER BY x.id)), '-') AS sum FROM ${t} x`)).rows[0];
  }
  sums.school_settings = (await c.query(
    "SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5(ROW(x.key, x.value, x.updated_by, x.updated_at)::text), '' ORDER BY x.key)), '-') AS sum FROM school_settings x WHERE x.key <> 'period_times'")).rows[0];
  const hasCol = (await c.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'subjects' AND column_name = 'is_active'")).rows.length > 0;

  if (phase === 'before') {
    if (hasCol) { console.error('  023 already applied here'); process.exit(1); }
    const subs = (await c.query(
      `SELECT s.name, s.code,
              (SELECT COUNT(*)::int FROM timetable t WHERE t.subject_id = s.id) AS slots,
              (SELECT COUNT(*)::int FROM teacher_subjects x WHERE x.subject_id = s.id) AS teachers,
              (SELECT COUNT(*)::int FROM teacher_classes x WHERE x.subject_id = s.id) AS assignments,
              (SELECT COUNT(*)::int FROM exams e WHERE e.subject_id = s.id) AS exams
       FROM subjects s ORDER BY s.name`)).rows;
    const used = subs.filter((s) => s.slots + s.teachers + s.assignments + s.exams > 0);
    console.log(`  subjects: ${subs.length} (${used.length} in use, ${subs.length - used.length} unused: ${subs.filter((s) => !used.includes(s)).map((s) => s.code).join(', ') || '-'})`);
    const refused = subs.filter((s) => !/^[A-Z0-9-]{1,10}$/.test(s.code.toUpperCase()));
    console.log(`  codes the new rules (letters, digits, "-") would refuse on edit: ${refused.map((s) => `"${s.code}"`).join(', ') || 'none'}`);
    const lower = subs.filter((s) => s.code !== s.code.toUpperCase());
    console.log(`  codes not upper case (left as they are; upper-cased only when edited): ${lower.map((s) => s.code).join(', ') || 'none'}`);
    const dup = (await c.query('SELECT upper(code) AS code, COUNT(*)::int n FROM subjects GROUP BY upper(code) HAVING COUNT(*) > 1')).rows;
    console.log(`  codes equal ignoring case: ${dup.map((d) => `${d.code} x${d.n}`).join(', ') || 'none'}`);
    const tt = (await c.query(
      `SELECT COUNT(*)::int n, COUNT(DISTINCT t.class_id)::int classes,
              COUNT(*) FILTER (WHERE t.day = 'Saturday')::int saturday, COUNT(*) FILTER (WHERE t.teacher_id IS NULL)::int no_teacher
       FROM timetable t`)).rows[0];
    console.log(`  timetable: ${tt.n} slot(s) in ${tt.classes} class(es), ${tt.saturday} on Saturday, ${tt.no_teacher} without a teacher`);
    const times = (await c.query(
      `SELECT period, to_char(start_time, 'HH24:MI') s, to_char(end_time, 'HH24:MI') e, COUNT(*)::int n
       FROM timetable GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC`)).rows;
    console.log(`  slot times in use: ${times.map((t) => `P${t.period} ${t.s}-${t.e} (${t.n})`).join(', ') || '-'}`);
    const clash = (await c.query(
      `SELECT COUNT(*)::int n FROM timetable a JOIN timetable b ON a.teacher_id = b.teacher_id AND a.day = b.day AND a.period = b.period AND a.id < b.id
       JOIN classes ca ON ca.id = a.class_id JOIN classes cb ON cb.id = b.class_id AND cb.academic_year_id = ca.academic_year_id`)).rows[0].n;
    console.log(`  teacher double bookings in one year (shown in the new grid): ${clash}`);
    const au = (await c.query("SELECT COUNT(*)::int n, to_char(MIN(created_at), 'YYYY-MM-DD') f, to_char(MAX(created_at), 'YYYY-MM-DD') l FROM audit_logs")).rows[0];
    console.log(`  audit_logs: ${au.n} entries (${au.f ?? '-'} .. ${au.l ?? '-'}); index idx_audit_created added`);
    console.log('  023 adds subjects.is_active (all TRUE) and the setting period_times (old timetable page hours)');
    fs.writeFileSync(SAVED, JSON.stringify({ sums }));
  } else if (phase === 'after') {
    const saved = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    for (const t of Object.keys(sums)) {
      const same = saved.sums[t].n === sums[t].n && saved.sums[t].sum === sums[t].sum;
      if (!same) bad++;
      console.log(`  ${t.padEnd(15)} rows ${saved.sums[t].n} -> ${sums[t].n}  ${same ? 'unchanged' : 'CHANGED'}`);
    }
    const act = (await c.query('SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE is_active)::int a FROM subjects')).rows[0];
    console.log(`  subjects active: ${act.a} of ${act.n}  ${act.a === act.n ? 'ok' : 'NOT ALL'}`); if (act.a !== act.n) bad++;
    const pt = (await c.query("SELECT value FROM school_settings WHERE key = 'period_times'")).rows[0]?.value;
    const ptOk = Array.isArray(pt) && pt.length === 8 && pt.every((p, i) => p.period === i + 1 && p.start < p.end);
    console.log(`  period_times: ${ptOk ? pt.map((p) => `${p.start}-${p.end}`).join(' ') : 'MISSING OR WRONG'}`); if (!ptOk) bad++;
    const idx = (await c.query("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_created'")).rows.length > 0;
    console.log(`  idx_audit_created: ${idx ? 'there' : 'MISSING'}`); if (!idx) bad++;
    console.log(bad ? `[check_023] ${bad} problem(s)` : '[check_023] OK');
  } else {
    console.error('usage: node tests/check_023.js before|after'); process.exit(1);
  }
  await c.end();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
