// src/routes/pdf.routes.js
const express = require('express');
const router  = express.Router();
const {
  getReportCardPDF,
  getStudentIDCardPDF,
  getTeacherIDCardPDF,
} = require('../controllers/pdf.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { adminOnly, allAuthenticated } = require('../middleware/role.middleware');
const { requireStudentAccess } = require('../middleware/studentAccess.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');

router.use(authenticate);

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)

// Report Card — admin, teacher, or the student themselves
router.get('/report-card/:studentId',
  allAuthenticated,
  requireStudentAccess('studentId'),
  checkIds,
  getReportCardPDF
);

// Student ID Card — admin only
router.get('/student-id/:studentId', adminOnly, checkIds, getStudentIDCardPDF);

// Teacher ID Card — admin only
router.get('/teacher-id/:teacherId', adminOnly, checkIds, getTeacherIDCardPDF);

module.exports = router;
