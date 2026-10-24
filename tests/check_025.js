// Dry run and before/after check for migration 025 (documents, M9) on asms_restore_check
// (also asms_phase0_test). Usage (through tests/restore_check.sh):
//   node tests/check_025.js before   rows by category and private/shared/unset, unknown categories
//                                    (025 refuses them), a checksum of every row
//   node tests/check_025.js after    the same rows (checksum of every column but is_private),
//                                    unset is_private now private, NOT NULL, category check present
// Read-only. Refuses any other database.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const DB = process.env.DB_NAME;
if (!['asms_restore_check', 'asms_phase0_test'].includes(DB)) { console.error('[check_025] ABORT: DB_NAME is', DB); process.exit(1); }
const phase = process.argv[2];
const SAVED = path.join(require('os').tmpdir(), `asms_check_025_${DB}.json`);
const KNOWN = ['id_document', 'birth_certificate', 'transcript', 'medical', 'photo', 'letter', 'certificate', 'report', 'other',
  'transfer_letter', 'report_card', 'national_exam'];
const COLS = 'x.id, x.student_id, x.teacher_id, x.category, x.title, x.description, x.file_name, x.file_path, x.file_size, x.mime_type, x.download_count, x.uploaded_by, x.created_at, x.updated_at';

(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB });
  await c.connect();
  if ((await c.query('SELECT current_database() d')).rows[0].d !== DB) process.exit(1);
  await c.query('SET default_transaction_read_only = on');
  let bad = 0;
  const check = (ok, label, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`); if (!ok) bad++; };
  const sum = async () => (await c.query(`SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg(md5(ROW(${COLS})::text), '' ORDER BY x.id)), '-') AS sum FROM documents x`)).rows[0];
  const counts = async () => (await c.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_private)::int AS private, COUNT(*) FILTER (WHERE is_private = FALSE)::int AS shared,
            COUNT(*) FILTER (WHERE is_private IS NULL)::int AS unset FROM documents`)).rows[0];
  const nullable = async () => (await c.query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'is_private'")).rows[0].is_nullable;

  if (phase === 'before') {
    const byCat = (await c.query('SELECT category, COUNT(*)::int n FROM documents GROUP BY 1 ORDER BY 1')).rows;
    console.log('  documents by category:', byCat.map((r) => `${r.category} ${r.n}`).join(', ') || 'none');
    const unknown = byCat.filter((r) => !KNOWN.includes(r.category));
    check(unknown.length === 0, 'no unknown categories (025 would stop)', unknown.map((r) => r.category).join(', '));
    const n = await counts();
    console.log(`  total ${n.total}: private ${n.private}, shared ${n.shared}, unset ${n.unset} (unset becomes private)`);
    fs.writeFileSync(SAVED, JSON.stringify({ sum: await sum(), counts: n }));
  } else if (phase === 'after') {
    const was = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    const now = await sum();
    const n = await counts();
    check(now.n === was.sum.n, `rows ${was.sum.n} -> ${now.n}`);
    check(now.sum === was.sum.sum, 'every row unchanged apart from is_private (checksum)');
    check(n.private === was.counts.private + was.counts.unset && n.shared === was.counts.shared && n.unset === 0,
      `private ${was.counts.private}+${was.counts.unset} unset -> ${n.private}, shared ${was.counts.shared} -> ${n.shared}`);
    check((await nullable()) === 'NO', 'is_private NOT NULL');
    check((await c.query("SELECT 1 FROM pg_constraint WHERE conname = 'documents_category_check'")).rows.length === 1, 'category check present');
  } else { console.error('usage: before|after'); process.exit(1); }
  await c.end();
  console.log(bad ? `[check_025] ${bad} FAIL` : '[check_025] OK');
  process.exit(bad ? 1 : 0);
})();
