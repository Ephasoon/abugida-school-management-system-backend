// Scratch only: removes the exams (and their scores) that earlier test runs left in the fixture
// classes 9A and 9B, so each run starts below the 100-point limit per subject and semester
// (D25, M5a). No suite relies on exams from an earlier run. The runner calls it.
const pool = require('./tdb');
const G = require('./g3.json');

(async () => {
  const classes = [G.c9A, G.c9B];
  const { rows } = await pool.query('SELECT id FROM exams WHERE class_id = ANY($1::uuid[])', [classes]);
  const ids = rows.map((r) => r.id);
  const g = await pool.query('DELETE FROM grades WHERE exam_id = ANY($1::uuid[])', [ids]);
  const e = await pool.query('DELETE FROM exams WHERE id = ANY($1::uuid[])', [ids]);   // exam_schedules cascade
  console.log(`[examreset] 9A/9B: removed ${e.rowCount} exam(s) and ${g.rowCount} score(s) from earlier runs`);
  await pool.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
