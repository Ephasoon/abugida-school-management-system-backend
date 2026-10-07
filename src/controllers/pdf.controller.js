// src/controllers/pdf.controller.js
// ============================================================
// PDF Generation Endpoints:
//   GET /api/pdf/report-card/:studentId   → Report Card PDF
//   GET /api/pdf/student-id/:studentId    → Student ID Card PDF
//   GET /api/pdf/teacher-id/:teacherId    → Teacher ID Card PDF
//   POST /api/pdf/bulk-ids               → Bulk ID Cards ZIP
// ============================================================

const db  = require('../config/db');
const {
  generateReportCard,
  generateStudentIDCard,
  generateTeacherIDCard,
} = require('../services/pdf.service');
const { sendError } = require('../utils/response');

const VALID_TERMS = ['term1', 'term2', 'term3'];


// ── GET /api/pdf/report-card/:studentId ──────────────────────
const getReportCardPDF = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { term }      = req.query;

    // Get full student + grades data
    const { rows: stuRows } = await db.query(
      `SELECT s.*, c.name AS class_name, c.grade_level, c.section,
              ay.name AS academic_year
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE s.id = $1`,
      [studentId]
    );

    if (!stuRows[0]) {
      return sendError(res, 'Student not found.', 404);
    }

    // Get grades grouped by subject
    if (term && !VALID_TERMS.includes(term)) {
      return sendError(res, `term must be one of: ${VALID_TERMS.join(', ')}`, 400);
    }
    const termFilter = term ? 'AND e.term = $2' : '';
    const gradeParams = term ? [studentId, term] : [studentId];
    const { rows: gradeRows } = await db.query(
      `SELECT s.name AS subject, s.name AS subject_name, s.code,
              e.term, e.exam_type, e.max_score,
              g.score, g.grade_letter,
              ROUND((g.score/e.max_score)*100, 1) AS percentage
       FROM grades g
       JOIN exams    e ON e.id  = g.exam_id
       JOIN subjects s ON s.id  = e.subject_id
       WHERE g.student_id = $1 ${termFilter}
       ORDER BY s.name, e.exam_type`,
      gradeParams
    );

    // Group by subject and calculate averages
    const subjectMap = {};
    gradeRows.forEach(row => {
      if (!subjectMap[row.subject]) {
        subjectMap[row.subject] = {
          subject:      row.subject,
          subject_name: row.subject_name,
          exams:        [],
          average:      0,
          grade_letter: '',
          grade_points: 0,
        };
      }
      subjectMap[row.subject].exams.push(row);
    });

    const subjects = Object.values(subjectMap).map(sub => {
      const total    = sub.exams.reduce((s,e) => s + parseFloat(e.score), 0);
      const maxTotal = sub.exams.reduce((s,e) => s + parseFloat(e.max_score), 0);
      const avg      = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
      sub.average      = avg.toFixed(1);
      sub.grade_letter = percentageToGrade(avg);
      sub.grade_points = gradeToPoints(sub.grade_letter);
      return sub;
    });

    // Calculate GPA and rank
    const gpa = subjects.length
      ? (subjects.reduce((s,sub) => s + sub.grade_points, 0) / subjects.length).toFixed(2)
      : '0.00';

    // Attendance
    const { rows: attRows } = await db.query(
      `SELECT COUNT(*) AS total_days,
              COUNT(*) FILTER (WHERE status='present') AS present,
              COUNT(*) FILTER (WHERE status='absent')  AS absent,
              COUNT(*) FILTER (WHERE status='late')    AS late,
              ROUND(COUNT(*) FILTER(WHERE status='present')*100.0/NULLIF(COUNT(*),0),1) AS rate
       FROM attendance WHERE student_id = $1`,
      [studentId]
    );

    // Rank in class
    const { rows: rankRows } = await db.query(
      `SELECT student_id,
              ROUND(AVG((g.score/e.max_score)*100), 2) AS avg
       FROM grades g JOIN exams e ON e.id=g.exam_id
       WHERE e.class_id = $1
       GROUP BY student_id ORDER BY avg DESC`,
      [stuRows[0].class_id]
    );
    const rankIdx = rankRows.findIndex(r => r.student_id === studentId);

    const data = {
      student:  stuRows[0],
      subjects,
      academic_summary: {
        gpa,
        rank:           rankIdx >= 0 ? rankIdx + 1 : null,
        total_in_class: rankRows.length,
        result:         parseFloat(gpa) >= 2.0 ? 'PASS' : 'FAIL',
      },
      attendance: attRows[0],
      school: {
        name:          process.env.SCHOOL_NAME || 'Äbugida School',
        code:          process.env.SCHOOL_CODE || 'ASMS',
        academic_year: process.env.ACADEMIC_YEAR || '2024/2025',
      },
    };

    await generateReportCard(data, res);

  } catch (err) {
    console.error('getReportCardPDF error:', err);
    if (!res.headersSent) {
      return sendError(res, 'Server error while generating report card.', 500);
    }
  }
};


// ── GET /api/pdf/student-id/:studentId ───────────────────────
const getStudentIDCardPDF = async (req, res) => {
  try {
    const { studentId } = req.params;

    const { rows } = await db.query(
      `SELECT s.*, c.name AS class_name, c.grade_level, c.section,
              ay.name AS academic_year
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE s.id = $1`,
      [studentId]
    );

    if (!rows[0]) return sendError(res, 'Student not found.', 404);

    await generateStudentIDCard({
      student: rows[0],
      school: {
        name: process.env.SCHOOL_NAME || 'Äbugida School',
        code: process.env.SCHOOL_CODE || 'ASMS',
      },
    }, res);

  } catch (err) {
    console.error('getStudentIDCardPDF error:', err);
    if (!res.headersSent) sendError(res, 'Server error.', 500);
  }
};


// ── GET /api/pdf/teacher-id/:teacherId ───────────────────────
const getTeacherIDCardPDF = async (req, res) => {
  try {
    const { teacherId } = req.params;

    const { rows } = await db.query(
      `SELECT t.*, u.email FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.id = $1`,
      [teacherId]
    );

    if (!rows[0]) return sendError(res, 'Teacher not found.', 404);

    await generateTeacherIDCard({
      teacher: rows[0],
      school: {
        name: process.env.SCHOOL_NAME || 'Äbugida School',
        code: process.env.SCHOOL_CODE || 'ASMS',
      },
    }, res);

  } catch (err) {
    console.error('getTeacherIDCardPDF error:', err);
    if (!res.headersSent) sendError(res, 'Server error.', 500);
  }
};


// ── Helpers ───────────────────────────────────────────────────
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


module.exports = {
  getReportCardPDF,
  getStudentIDCardPDF,
  getTeacherIDCardPDF,
};
