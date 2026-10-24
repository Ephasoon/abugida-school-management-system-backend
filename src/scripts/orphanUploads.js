// Files in the documents upload folder that no documents row refers to (e.g. left behind by
// test runs). Read-only by default: lists them, and the rows whose file is missing.
// --move moves the listed files into uploads/_to_delete/<time>/ (never deletes) and writes
// a manifest there, so they can be put back.
//
//   node src/scripts/orphanUploads.js [--db <name>] [--dir <folder>] [--move]
//
// The database connection is read-only (default_transaction_read_only), whatever --db says.
// A file counts as referenced when a row's file_path has the same file name (rows written
// on another machine keep another folder in their path).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const MOVE = process.argv.includes('--move');
const DB = arg('--db') || process.env.DB_NAME;
const DIR = path.resolve(arg('--dir') || process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads', 'documents'));
const BIN = path.join(path.dirname(DIR), '_to_delete');

(async () => {
  if (!fs.existsSync(DIR)) { console.error(`No folder ${DIR}`); process.exit(1); }
  const db = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: DB, options: '-c default_transaction_read_only=on',
  });
  await db.connect();
  const { rows } = await db.query('SELECT id, title, file_name, file_path FROM documents');
  await db.end();

  const referenced = new Set(rows.map((r) => path.basename(r.file_path)));
  const files = fs.readdirSync(DIR, { withFileTypes: true }).filter((f) => f.isFile()).map((f) => f.name).sort();
  const orphans = files.filter((f) => !referenced.has(f));
  const missing = rows.filter((r) => !files.includes(path.basename(r.file_path)));
  const size = (f) => fs.statSync(path.join(DIR, f)).size;

  console.log(`Database: ${DB} (read-only) · folder: ${DIR}`);
  console.log(`${files.length} file(s), ${rows.length} document row(s), ${orphans.length} file(s) not referenced, ${missing.length} row(s) without their file`);
  for (const f of orphans) {
    const st = fs.statSync(path.join(DIR, f));
    console.log(`  orphan  ${f}  ${st.size} B  ${st.mtime.toISOString().slice(0, 16).replace('T', ' ')}`);
  }
  for (const r of missing) console.log(`  missing ${r.id}  "${r.title}"  (${r.file_name}) -> ${path.basename(r.file_path)}`);

  if (!MOVE) { console.log(orphans.length ? '\nNothing moved (run with --move to move them).' : ''); return; }
  if (!orphans.length) { console.log('Nothing to move.'); return; }
  const to = path.join(BIN, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(to, { recursive: true });
  const manifest = [];
  for (const f of orphans) {
    manifest.push({ file: f, from: path.join(DIR, f), bytes: size(f) });
    fs.renameSync(path.join(DIR, f), path.join(to, f));
  }
  fs.writeFileSync(path.join(to, 'manifest.json'), JSON.stringify({ database: DB, moved_at: new Date().toISOString(), files: manifest }, null, 2));
  console.log(`\nMoved ${orphans.length} file(s) to ${to} (manifest.json lists where they came from).`);
})().catch((err) => { console.error(err.message); process.exit(1); });
