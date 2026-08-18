// src/controllers/grade.controller.js
// Fixed: academic_year_id now fetched automatically from current active year

const db            = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');

// Helper: get current academic year id
const getCurrentYearId = async () => {
  const { rows } = await db.query(
    'SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1'
  );
  return rows[0]?.id || null;
};

// Helper: grade letter from percentage
const percentageToGrade = (pct) => {
  if (pct >= 90) return 'A+';
  if (pct >= 85) return 'A';
  if (pct >= 80) return 'A-';
  if (pct >= 75) return 'B+';
  if (pct >= 70) return 'B';
  if (pct >= 65) return 'B-';
  if (pct >= 60) return 'C+';
  if (pct >= 55) return 'C';
  if (pct >= 50) return 'C-';
  if (pct >= 45) return 'D';
  return 'F';
};

const gradeToPoints = (l) => ({
  'A+':4.0,'A':4.0,'A-':3.7,'B+':3.3,'B':3.0,'B-':2.7,
  'C+':2.3,'C':2.0,'C-':1.7,'D':1.0,'F':0.0,
}[l] || 0);

// POST /api/grades/exams — Create exam
const createExam = async (req, res) => {
  try {
    const {
      class_id, subject_id, name, exam_type,
      term, max_score = 100, exam_date,
    } = req.body;

    if (!class_id || !subject_id || !name || !exam_type || !term) {
      return sendError(res, 'class_id, subject_id, name, exam_type, and term are required.', 400);
    }

    // Auto-get current academic year
    const academic_year_id = await getCurrentYearId();
    if (!academic_year_id) {
      return sendError(res, 'No active academic year found. Please activate an academic year first.', 400);
    }

    // Get teacher id if user is teacher
    let created_by = null;
    if (req.user.role === 'teacher') {
      const { rows: tRows } = await db.query(
        'SELECT id FROM teachers WHERE user_id = $1', [req.user.id]
      );
      created_by = tRows[0]?.id || null;
    }

    const { rows } = await db.query(
      `INSERT INTO exams
         (class_id, subject_id, academic_year_id, name, exam_type,
          term, max_score, exam_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        class_id, subject_id, academic_year_id,
        name.trim(), exam_type, term,
        parseFloat(max_score),
        exam_date || null,
        created_by,
      ]
    );

    return sendSuccess(res, rows[0], `Exam "${name}" created successfully.`, 201);

  } catch (err) {
    console.error('createExam:', err.message);
    return sendError(res, 'Server error: ' + err.message, 500);
  }
};

// GET /api/grades/exams — List exams
const getExams = async (req, res) => {
  try {
    const { class_id, term, subject_id } = req.query;
    const conditions = []; const params = []; let idx = 1;
    if (class_id)   { conditions.push(`e.class_id=$${idx++}`);   params.push(class_id); }
    if (term)       { conditions.push(`e.term=$${idx++}`);        params.push(term); }
    if (subject_id) { conditions.push(`e.subject_id=$${idx++}`);  params.push(subject_id); }
    const where = conditions.length ? 'WHERE '+conditions.join(' AND ') : '';

    const { rows } = await db.query(
      `SELECT e.*,
         c.name AS class_name, c.grade_level,
         s.name AS subject_name, s.code AS subject_code,
         COUNT(g.id) AS grades_entered
       FROM exams e
       LEFT JOIN classes  c ON c.id=e.class_id
       LEFT JOIN subjects s ON s.id=e.subject_id
       LEFT JOIN grades   g ON g.exam_id=e.id
       ${where}
       GROUP BY e.id, c.name, c.grade_level, s.name, s.code
       ORDER BY e.created_at DESC`,
      params
    );
    return sendSuccess(res, rows, `Found ${rows.length} exam(s).`);
  } catch (err) {
    console.error('getExams:', err.message);
    return sendError(res, 'Server error: ' + err.message, 500);
  }
};

// POST /api/grades — Enter grades for an exam
const enterGrades = async (req, res) => {
  try {
    const { exam_id, grades } = req.body;
    if (!exam_id || !grades || !Array.isArray(grades)) {
      return sendError(res, 'exam_id and grades array are required.', 400);
    }

    // Get exam to calculate grade letters
    const { rows: examRows } = await db.query(
      'SELECT * FROM exams WHERE id=$1', [exam_id]
    );
    if (!examRows[0]) return sendError(res, 'Exam not found.', 404);
    const exam = examRows[0];

    let saved = 0;
    for (const g of grades) {
      if (g.student_id && g.score !== undefined && g.score !== null) {
        const pct    = (parseFloat(g.score) / parseFloat(exam.max_score)) * 100;
        const letter = percentageToGrade(pct);

        await db.query(
          `INSERT INTO grades (exam_id, student_id, score, grade_letter, remarks)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (exam_id, student_id)
           DO UPDATE SET score=$3, grade_letter=$4, remarks=$5, entered_at=NOW()`,
          [exam_id, g.student_id, parseFloat(g.score), letter, g.remarks || null]
        );
        saved++;
      }
    }

    return sendSuccess(res, { total_graded: saved },
      `Grades saved for ${saved} student(s).`);

  } catch (err) {
    console.error('enterGrades:', err.message);
    return sendError(res, 'Server error: ' + err.message, 500);
  }
};

// GET /api/grades/report-card/:studentId
const getReportCard = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { term } = req.query;

    const { rows: stuRows } = await db.query(
      `SELECT s.*, c.name AS class_name, c.grade_level, c.section,
              ay.name AS academic_year
       FROM students s
       LEFT JOIN classes c ON c.id=s.class_id
       LEFT JOIN academic_years ay ON ay.id=c.academic_year_id
       WHERE s.id=$1`, [studentId]
    );
    if (!stuRows[0]) return sendError(res, 'Student not found.', 404);

    const termFilter = term ? `AND e.term='${term}'` : '';
    const { rows: gradeRows } = await db.query(
      `SELECT s.name AS subject, e.term, e.exam_type, e.max_score,
              g.score, g.grade_letter,
              ROUND((g.score/e.max_score)*100,1) AS percentage
       FROM grades g
       JOIN exams    e ON e.id=g.exam_id
       JOIN subjects s ON s.id=e.subject_id
       WHERE g.student_id=$1 ${termFilter}
       ORDER BY s.name, e.exam_type`, [studentId]
    );

    // Group by subject
    const subjectMap = {};
    gradeRows.forEach(row => {
      if (!subjectMap[row.subject]) {
        subjectMap[row.subject] = { subject:row.subject, exams:[], average:0, grade_letter:'', grade_points:0 };
      }
      subjectMap[row.subject].exams.push(row);
    });

    const subjects = Object.values(subjectMap).map(sub => {
      const total    = sub.exams.reduce((s,e)=>s+parseFloat(e.score),0);
      const maxTotal = sub.exams.reduce((s,e)=>s+parseFloat(e.max_score),0);
      const avg      = maxTotal > 0 ? (total/maxTotal)*100 : 0;
      sub.average      = avg.toFixed(1);
      sub.grade_letter = percentageToGrade(avg);
      sub.grade_points = gradeToPoints(sub.grade_letter);
      return sub;
    });

    const gpa = subjects.length
      ? (subjects.reduce((s,sub)=>s+sub.grade_points,0)/subjects.length).toFixed(2)
      : '0.00';

    const { rows: att } = await db.query(
      `SELECT COUNT(*) AS total_days,
              COUNT(*) FILTER(WHERE status='present') AS present,
              COUNT(*) FILTER(WHERE status='absent')  AS absent,
              COUNT(*) FILTER(WHERE status='late')    AS late,
              ROUND(COUNT(*) FILTER(WHERE status='present')*100.0/NULLIF(COUNT(*),0),1) AS rate
       FROM attendance WHERE student_id=$1`, [studentId]
    );

    return sendSuccess(res, {
      student: stuRows[0],
      subjects,
      academic_summary: {
        gpa,
        result: parseFloat(gpa) >= 2.0 ? 'PASS' : 'FAIL',
      },
      attendance: att[0],
    }, 'Report card retrieved.');

  } catch (err) {
    console.error('getReportCard:', err.message);
    return sendError(res, 'Server error: ' + err.message, 500);
  }
};

module.exports = { createExam, getExams, enterGrades, getReportCard };
