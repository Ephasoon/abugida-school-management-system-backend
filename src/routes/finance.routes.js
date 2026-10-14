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
const { adminOnly, schoolLeaders }  = require('../middleware/role.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');

router.use(authenticate);

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)
// Finance: admin full access, principal view only; teachers and students none.
// Parents see their own children's fees through /api/parent.
router.post('/payments',              adminOnly,     validateBodyIds({ student_id: 'students', fee_structure_id: 'fee_structures' }), recordPayment);
router.get ('/payments',              schoolLeaders, getPayments);
router.get ('/summary',               schoolLeaders, getFinanceSummary);
router.get ('/student/:studentId',    schoolLeaders, checkIds, getStudentBalance);
router.get ('/unpaid',                schoolLeaders, getUnpaidStudents);

module.exports = router;