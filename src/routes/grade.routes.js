// src/routes/grade.routes.js
const express = require('express');
const router  = express.Router();
const {
  createExam,
  getExams,
  enterGrades,
  getReportCard,
} = require('../controllers/grade.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { teacherOrAdmin, allStaff, allAuthenticated } = require('../middleware/role.middleware');
const { requireStudentAccess } = require('../middleware/studentAccess.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');

router.use(authenticate);

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)

// Exams
router.post('/exams', teacherOrAdmin, createExam);   // deprecated: use POST /api/exam-schedule
router.get ('/exams', allStaff,       getExams);   // teachers: own classes only

// Grades
router.post('/',                        teacherOrAdmin, enterGrades);
router.get ('/report-card/:studentId',  allAuthenticated, requireStudentAccess('studentId'), checkIds, getReportCard);

module.exports = router;