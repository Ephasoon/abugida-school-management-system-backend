// src/routes/finance.routes.js
const express = require('express');
const router  = express.Router();
const {
  recordPayment,
  getPayments,
  getFinanceSummary,
  getStudentBalance,
  getUnpaidStudents,
} = require('../controllers/finance.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { adminOnly, teacherOrAdmin } = require('../middleware/role.middleware');

router.use(authenticate);

router.post('/payments',              adminOnly,      recordPayment);
router.get ('/payments',              teacherOrAdmin, getPayments);
router.get ('/summary',               teacherOrAdmin, getFinanceSummary);
router.get ('/student/:studentId',    teacherOrAdmin, getStudentBalance);
router.get ('/unpaid',                teacherOrAdmin, getUnpaidStudents);

module.exports = router;