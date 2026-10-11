// Test-only: three students with logins in the scratch DB (one per deactivation path)
const pool = require('./tdb');
const bcrypt = require('bcryptjs');
(async () => {
  console.log('[mkstudents] db =', (await pool.query('select current_database() d')).rows[0].d);
  const h = bcrypt.hashSync('Stud#2026', 4);
  const out = {};
  for (const [key, grade] of [['archive', 9], ['suspend', 9], ['graduate', 12]]) {
    const email = `s_${key}_${Date.now()}@asms.et`;
    const u = (await pool.query("insert into users (email,password_hash,role) values ($1,$2,'student') returning id", [email, h])).rows[0].id;
    const c = (await pool.query("select id from classes where grade_level=$1 and section='B'", [grade])).rows[0].id;
    const s = (await pool.query(`insert into students (user_id,student_number,first_name,last_name,gender,class_id)
      values ($1,$2,'Stu',$3,'female',$4) returning id`, [u, 'T-' + key.slice(0,3) + String(Date.now()).slice(-6), key, c])).rows[0].id;
    out[key] = { email, studentId: s };
  }
  console.log(JSON.stringify(out)); await pool.end();
})();
