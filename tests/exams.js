// Test helper (M10): exams are created through POST /exam-schedule, which needs a date (the old
// POST /grades/exams took undated exams and was removed). Scratch DB only.
//   examDate(classId, semester)       → a date 10 days into that semester of the class's year
//   newExam(call, tok, body)          → POST /exam-schedule with body.exam_date, or that date
//                                       for body.semester (default 1)
const pool = require('./tdb');

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const examDate = async (classId, semester = 1) => {
  const y = (await pool.query(
    `SELECT y.start_date::text AS s1, y.semester2_start::text AS s2 FROM classes c
     JOIN academic_years y ON y.id = c.academic_year_id WHERE c.id = $1`, [classId])).rows[0];
  if (!y) throw new Error(`examDate: no class ${classId}`);
  return addDays(Number(semester) === 2 ? y.s2 : y.s1, 10);
};

const newExam = async (call, tok, body) =>
  call(tok, 'POST', '/exam-schedule', { ...body, exam_date: body.exam_date ?? await examDate(body.class_id, body.semester ?? 1) });

module.exports = { examDate, newExam };
