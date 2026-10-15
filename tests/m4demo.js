// Scratch-only setup for trying the M4 attendance screens by hand (never asms):
//   bash tests/guard.sh node tests/m4demo.js            make the year around today current, class
//                                                       5A in it with 4 students, teacher A assigned
//   bash tests/guard.sh node tests/m4demo.js --restore  archive them, unassign, 2024/2025 current again
// Needs the test server on :3100 (bash tests/srv.sh). Always run --restore before the test suites.
const pool = require('./tdb');
const { useTodayYear, restoreFixtureYear } = require('./todayyear');
const G = require('./g3.json');
const API = 'http://localhost:3100/api';
const call = async (tok, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

(async () => {
  if ((await pool.query('select current_database() d')).rows[0].d !== 'asms_phase0_test') throw new Error('not the scratch DB');
  const A = (await call(null, 'POST', '/auth/login', { email: 'admin@asms.et', password: 'Admin@1234' })).body.data.accessToken;
  const demo = (await pool.query("SELECT id::text FROM students WHERE last_name = 'M4Demo' AND status = 'active'")).rows.map((r) => r.id);
  const demoClasses = (await pool.query("SELECT DISTINCT class_id::text AS id FROM students WHERE last_name = 'M4Demo' AND class_id IS NOT NULL")).rows.map((r) => r.id);

  if (process.argv.includes('--restore')) {
    for (const id of demo) await call(A, 'DELETE', `/students/${id}`);
    for (const c of demoClasses) await call(A, 'DELETE', `/teachers/${G.tA.tid}/classes/${c}/${G.math}`);
    await restoreFixtureYear(call, A);
    console.log(`[m4demo] restored: ${demo.length} demo student(s) archived, teacher A unassigned, 2024/2025 is current again`);
  } else {
    const { year } = await useTodayYear(call, A);
    const list = (await call(A, 'GET', `/classes?academic_year_id=${year.id}`)).body.data;
    const cls = list.find((c) => c.grade_level === 5 && c.section === 'A')?.id
      ?? (await call(A, 'POST', '/classes', { academic_year_id: year.id, grade_level: 5, section: 'A' })).body.data.id;
    await call(A, 'POST', `/teachers/${G.tA.tid}/classes`, { class_id: cls, subject_id: G.math });
    if (!demo.length) {
      for (const [first, fathers, am, fam] of [['Abebe', 'Kebede', 'አበበ', 'ከበደ'], ['Abebe', 'Tadesse', 'አበበ', 'ታደሰ'], ['Hana', 'Girma', 'ሐና', 'ግርማ'], ['Sara', 'Lemma', null, null]]) {
        await call(A, 'POST', '/students', { first_name: first, fathers_name: fathers, last_name: 'M4Demo', first_name_am: am, fathers_name_am: fam, gender: 'female', class_id: cls });
      }
    }
    console.log(`[m4demo] ready: ${year.name} is current, Grade 5 Section A with 4 students (two named Abebe)`);
    console.log(`  admin:     admin@asms.et / Admin@1234`);
    console.log(`  teacher A: ${G.tA.email} / Pass#2026`);
    console.log(`  principal: principal.g7@asms.et / Pass#2026`);
    console.log('  Undo before running the test suites: bash tests/guard.sh node tests/m4demo.js --restore');
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
