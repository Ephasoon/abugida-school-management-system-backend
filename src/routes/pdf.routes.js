// src/routes/pdf.routes.js
const express = require('express');
const router  = express.Router();
const {
  getReportCardPDF,
  getStudentIDCardPDF,
  getTeacherIDCardPDF,
  getReceiptPDF,
} = require('../controllers/pdf.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { adminOnly, allAuthenticated, authorize } = require('../middleware/role.middleware');
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

// Payment receipt (M8, G5) — admin, principal, or a parent of the student (checked in the controller)
router.get('/receipt/:paymentId', authorize('admin', 'principal', 'parent'), validateIds({ paymentId: 'payments' }), getReceiptPDF);

module.exports = router;
