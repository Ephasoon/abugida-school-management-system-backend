// Delete files uploaded during tests: only paths recorded in the scratch DB, only under tests/uploads/documents.
const pool = require('./tdb'); const fs = require('fs'); const path = require('path');
const ROOT = require('./uploadDir');
(async () => {
  const { rows } = await pool.query('SELECT file_path FROM documents');
  let n = 0;
  for (const { file_path } of rows) {
    const p = path.resolve(file_path);
    if (path.dirname(p) !== ROOT) { console.log('skip (outside uploads):', p); continue; }
    if (fs.existsSync(p)) { fs.unlinkSync(p); n++; }
  }
  console.log(`[cleanup] removed ${n} test file(s); recorded in scratch DB: ${rows.length}`);
  await pool.end();
})();
