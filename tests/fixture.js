const pool = require('./tdb');
(async () => {
  const db = (await pool.query('select current_database() d')).rows[0].d; console.log('[fixture] connected to', db);
  const cls = (await pool.query("select id from classes where grade_level=9 and section='A'")).rows[0].id;
  const sub = (await pool.query("select id from subjects where code='MATH'")).rows[0].id;
  const ay  = (await pool.query("select id from academic_years where is_current")).rows[0].id;
  const st  = (await pool.query(`insert into students (student_number,first_name,last_name,gender,class_id)
     values ('T-001','Abebe','Kebede','male',$1) returning id`, [cls])).rows[0].id;
  for (const [t, sc] of [['term1', 80], ['term2', 60]]) {
    const ex = (await pool.query(`insert into exams (class_id,subject_id,academic_year_id,name,exam_type,term)
       values ($1,$2,$3,$4,'midterm',$5) returning id`, [cls, sub, ay, 'Mid '+t, t])).rows[0].id;
    await pool.query('insert into grades (student_id,exam_id,score) values ($1,$2,$3)', [st, ex, sc]);
  }
  await pool.query(`insert into payments (student_id,academic_year_id,term,category,amount_due,amount_paid)
     values ($1,$2,'term1','tuition',3500,1000)`, [st, ay]);
  await pool.query(`insert into attendance (student_id,class_id,date,status) values ($1,$2,'2026-10-01','present'),($1,$2,'2026-10-02','absent')`, [st, cls]);
  console.log('student', st); await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
