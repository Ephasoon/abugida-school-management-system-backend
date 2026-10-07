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
const { adminOnly }                 = require('../middleware/role.middleware');

router.use(authenticate);
router.use(adminOnly); // Finance is admin-only (teachers have no access)

router.post('/payments',              recordPayment);
router.get ('/payments',              getPayments);
router.get ('/summary',               getFinanceSummary);
router.get ('/student/:studentId',    getStudentBalance);
router.get ('/unpaid',                getUnpaidStudents);

module.exports = router;