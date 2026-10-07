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

router.use(authenticate);

// Exams
router.post('/exams', teacherOrAdmin, createExam);
router.get ('/exams', allStaff,       getExams);   // teachers: own classes only

// Grades
router.post('/',                        teacherOrAdmin, enterGrades);
router.get ('/report-card/:studentId',  allAuthenticated, requireStudentAccess('studentId'), getReportCard);

module.exports = router;