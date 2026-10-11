// Fresh-install simulation inside the scratch DB: every migration runs in schema fresh_install.
const pool = require('./tdb'); const fs = require('fs'); const path = require('path');
const bcrypt = require('bcryptjs');
const DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const run = async (c, f) => { await c.query('BEGIN'); try { await c.query(fs.readFileSync(path.join(DIR, f), 'utf8')); await c.query('COMMIT'); return 'ok'; } catch (e) { await c.query('ROLLBACK'); return 'FAILED: ' + e.message; } };
(async () => {
  const c = await pool.connect();
  console.log('[fresh] db =', (await c.query('select current_database() d')).rows[0].d);
  await c.query('DROP SCHEMA IF EXISTS fresh_install CASCADE; CREATE SCHEMA fresh_install');
  await c.query('SET search_path TO fresh_install, public');
  for (const f of files) {
    if (f.startsWith('014')) {   // simulate existing data from before the sequences
      await c.query(`INSERT INTO students (student_number,first_name,last_name,gender)
        VALUES ('ASMS-2025-004','A','B','male'),('ASMS-2026-006','C','D','female'),('LEGACY-99','E','F','male')`);
      const u = (await c.query("INSERT INTO users (email,password_hash,role) VALUES ('x@t','x','teacher') RETURNING id")).rows[0].id;
      await c.query("INSERT INTO teachers (user_id,teacher_number,first_name,last_name) VALUES ($1,'TCH-007','T','T')", [u]);
    }
    if (f.startsWith('015')) {   // first run 015 against bad data, expect a clean abort
      const ex = (await c.query(`INSERT INTO exams (class_id,subject_id,academic_year_id,name,exam_type,term,max_score)
        SELECT c.id,(SELECT id FROM subjects LIMIT 1),c.academic_year_id,'Bad','quiz','term1',10 FROM classes c LIMIT 1 RETURNING id`)).rows[0].id;
      const st = (await c.query("SELECT id FROM students LIMIT 1")).rows[0].id;
      await c.query('ALTER TABLE grades DISABLE TRIGGER trg_set_grade_letter');
      await c.query('INSERT INTO grades (student_id,exam_id,score) VALUES ($1,$2,50)', [st, ex]);
      await c.query('ALTER TABLE grades ENABLE TRIGGER trg_set_grade_letter');
      console.log(`  ${f} with 1 bad grade -> ${await run(c, f)}`);
      await c.query('DELETE FROM grades WHERE exam_id=$1', [ex]);
    }
    console.log(`  ${f} -> ${await run(c, f)}`);
    if (f.startsWith('001')) {
      const h = (await c.query("SELECT password_hash FROM users WHERE email='admin@asms.et'")).rows[0].password_hash;
      console.log('     after 001: Admin@1234 works?', bcrypt.compareSync('Admin@1234', h));
    }
  }
  const a = (await c.query("SELECT password_hash, must_change_password FROM users WHERE email='admin@asms.et'")).rows[0];
  console.log('[013] Admin@1234 works?', bcrypt.compareSync('Admin@1234', a.password_hash), ' must_change_password =', a.must_change_password);
  console.log('[014] next student seq =', (await c.query("SELECT nextval('student_number_seq') n")).rows[0].n, '(existing max ASMS-*-006)');
  console.log('[014] next teacher seq =', (await c.query("SELECT nextval('teacher_number_seq') n")).rows[0].n, '(existing max TCH-007)');
  const e = (await c.query("SELECT id FROM exams WHERE name='Bad'")).rows[0].id, s = (await c.query('SELECT id FROM students LIMIT 1')).rows[0].id;
  const tryq = async (label, sql, p) => { try { await c.query(sql, p); console.log(`[015] ${label}: allowed`); } catch (x) { console.log(`[015] ${label}: rejected (${x.code}) ${x.message}`); } };
  await tryq('grade 10/10', 'INSERT INTO grades (student_id,exam_id,score) VALUES ($1,$2,10)', [s, e]);
  await tryq('grade 10.5/10', 'UPDATE grades SET score=10.5 WHERE exam_id=$1', [e]);
  await tryq('lower max_score to 5 (existing 10)', 'UPDATE exams SET max_score=5 WHERE id=$1', [e]);
  await tryq('max_score 0', 'UPDATE exams SET max_score=0 WHERE id=$1', [e]);
  await tryq('raise max_score to 20', 'UPDATE exams SET max_score=20 WHERE id=$1', [e]);
  await c.query('SET search_path TO public'); await c.query('DROP SCHEMA fresh_install CASCADE');
  console.log('[fresh] schema fresh_install dropped'); c.release(); await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
