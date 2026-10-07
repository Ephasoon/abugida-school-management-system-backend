// src/routes/pdf.routes.js
const express = require('express');
const router  = express.Router();
const {
  getReportCardPDF,
  getStudentIDCardPDF,
  getTeacherIDCardPDF,
} = require('../controllers/pdf.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { teacherOrAdmin, authorize } = require('../middleware/role.middleware');
const { requireStudentAccess } = require('../middleware/studentAccess.middleware');

router.use(authenticate);

// Report Card — admin, teacher, or the student themselves
router.get('/report-card/:studentId',
  authorize('admin','teacher','student','parent'),
  requireStudentAccess('studentId'),
  getReportCardPDF
);

// Student ID Card — admin or teacher
router.get('/student-id/:studentId', teacherOrAdmin, getStudentIDCardPDF);

// Teacher ID Card — admin only
router.get('/teacher-id/:teacherId', teacherOrAdmin, getTeacherIDCardPDF);

module.exports = router;
