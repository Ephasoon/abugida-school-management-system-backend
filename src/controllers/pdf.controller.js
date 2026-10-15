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
const { sendServerError } = require('../utils/errors');

const { semesterFilter } = require('../utils/semesters');
const { studentResults, ResultsError } = require('../services/results.service');


// ── GET /api/pdf/report-card/:studentId?academic_year_id= ────
// Both semesters and the year from the results service (M5a, B2), so the PDF shows the
// same numbers as the report card and the class results. The old ?term= / ?semester=
// are still accepted (validated) and print the same full report card.
const getReportCardPDF = async (req, res) => {
  try {
    const { studentId } = req.params;
    const sf = semesterFilter(req.query);
    if (sf.error) return sendError(res, sf.error, 400, { field: 'semester' });
    const { academic_year_id } = req.query;
    if (academic_year_id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(academic_year_id))) {
      return sendError(res, 'academic_year_id does not exist.', 400, { field: 'academic_year_id' });
    }

    const { rows: stuRows } = await db.query(
      `SELECT s.*, c.name AS class_name, c.grade_level, c.section,
              ay.name AS academic_year
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE s.id = $1`,
      [studentId]
    );
    if (!stuRows[0]) return sendError(res, 'Student not found.', 404);

    let results = null;
    try {
      results = await studentResults(studentId, academic_year_id);
    } catch (err) {
      if (!(err instanceof ResultsError) || err.status !== 404) throw err;   // no class / results yet
    }

    await generateReportCard({
      student: stuRows[0],
      results,
      school: {
        name:    process.env.SCHOOL_NAME || 'Äbugida School',
        name_am: process.env.SCHOOL_NAME_AM ?? (process.env.SCHOOL_NAME ? '' : undefined),
        code:    process.env.SCHOOL_CODE || 'ASMS',
      },
    }, res);

  } catch (err) {
    if (!res.headersSent) {
      return sendServerError(res, err, 'Server error while generating report card.');
    }
    console.error('getReportCardPDF failed after streaming started:', err);
  }
};


// ── GET /api/pdf/student-id/:studentId ───────────────────────
const getStudentIDCardPDF = async (req, res) => {
  try {
    const { studentId } = req.params;

    const { rows } = await db.query(
      `SELECT s.*, c.name AS class_name, c.grade_level, c.section,
              ay.name AS academic_year,
              ay.end_date AS academic_year_end
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
    if (!res.headersSent) return sendServerError(res, err, 'Server error.');
    console.error('ID card PDF failed after streaming started:', err);
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
    if (!res.headersSent) return sendServerError(res, err, 'Server error.');
    console.error('ID card PDF failed after streaming started:', err);
  }
};


module.exports = {
  getReportCardPDF,
  getStudentIDCardPDF,
  getTeacherIDCardPDF,
};
