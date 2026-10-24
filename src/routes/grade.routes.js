// src/routes/grade.routes.js
const express = require('express');
const router  = express.Router();
const {
  getExams,
  getExamGrades,
  enterGrades,
  getReportCard,
} = require('../controllers/grade.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { teacherOrAdmin, allStaff, allAuthenticated } = require('../middleware/role.middleware');
const { requireStudentAccess } = require('../middleware/studentAccess.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');

router.use(authenticate);

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)

// Exams
router.get ('/exams', allStaff,       getExams);   // teachers: own classes only
router.get ('/exams/:examId', allStaff, checkIds, getExamGrades);   // G1: one exam + scores entered (teacher: own class+subject)

// Grades
router.post('/',                        teacherOrAdmin, validateBodyIds({ exam_id: 'exams', 'grades[].student_id': 'students' }), enterGrades);
router.get ('/report-card/:studentId',  allAuthenticated, requireStudentAccess('studentId'), checkIds, getReportCard);

module.exports = router;