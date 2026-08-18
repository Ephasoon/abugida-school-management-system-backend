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
const { adminOnly, teacherOrAdmin, authorize } = require('../middleware/role.middleware');

router.use(authenticate);

// Exams
router.post('/exams', teacherOrAdmin, createExam);
router.get ('/exams', teacherOrAdmin, getExams);

// Grades
router.post('/',                        teacherOrAdmin, enterGrades);
router.get ('/report-card/:studentId',  authorize('admin','teacher','student','parent'), getReportCard);

module.exports = router;