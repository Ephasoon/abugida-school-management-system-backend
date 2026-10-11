// Test-only fixture for Group 3 in the scratch DB.
const pool = require('./tdb');
const bcrypt = require('bcryptjs');
(async () => {
  console.log('[g3fix] db =', (await pool.query('select current_database() d')).rows[0].d);
  // Mirror of the hand-made documents table in the live DB (read earlier, read-only)
  await pool.query(`CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
    category VARCHAR NOT NULL, title VARCHAR NOT NULL, description TEXT,
    file_name VARCHAR NOT NULL, file_path VARCHAR NOT NULL, file_size INTEGER DEFAULT 0,
    mime_type VARCHAR, is_private BOOLEAN DEFAULT TRUE, download_count INTEGER DEFAULT 0,
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  const h = bcrypt.hashSync('Pass#2026', 4), tag = String(Date.now()).slice(-6);
  const user = async (role) => (await pool.query(
    'insert into users (email,password_hash,role) values ($1,$2,$3) returning id,email',
    [`g3_${role}_${tag}_${Math.random().toString(36).slice(2,6)}@asms.et`, h, role])).rows[0];
  const cls = async (g, s) => (await pool.query('select id from classes where grade_level=$1 and section=$2', [g, s])).rows[0].id;
  const subj = async (c) => (await pool.query('select id from subjects where code=$1', [c])).rows[0].id;
  const c9A = await cls(9, 'A'), c9B = await cls(9, 'B'), math = await subj('MATH'), eng = await subj('ENG');
  const teacher = async (n) => { const u = await user('teacher');
    const t = (await pool.query(`insert into teachers (user_id,teacher_number,first_name,last_name)
      values ($1,$2,'T',$3) returning id`, [u.id, 'G3-' + n + tag, n])).rows[0].id; return { ...u, tid: t }; };
  const tA = await teacher('A'), tB = await teacher('B');
  await pool.query('insert into teacher_classes (teacher_id,class_id,subject_id) values ($1,$2,$3)', [tA.tid, c9A, math]);
  const student = async (n, c) => { const u = await user('student');
    const s = (await pool.query(`insert into students (user_id,student_number,first_name,last_name,gender,class_id)
      values ($1,$2,'S',$3,'male',$4) returning id`, [u.id, 'G3' + n + tag, n, c])).rows[0].id; return { ...u, sid: s }; };
  const s1 = await student('1', c9A), s2 = await student('2', c9A), s3 = await student('3', c9B);
  const pu = await user('parent');
  const pid = (await pool.query("insert into parents (user_id,full_name,phone) values ($1,'Parent One','0911000001') returning id", [pu.id])).rows[0].id;
  await pool.query("insert into student_parents (student_id,parent_id,relationship,is_primary) values ($1,$2,'father',true)", [s1.sid, pid]);
  console.log(JSON.stringify({ tA, tB, s1, s2, s3, parent: pu, c9A, c9B, math, eng }));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
