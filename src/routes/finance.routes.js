// src/routes/finance.routes.js
const express = require('express');
const router  = express.Router();
const C = require('../controllers/finance.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { adminOnly, schoolLeaders }  = require('../middleware/role.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');

router.use(authenticate);

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)
const feeId = validateIds({ id: 'fee_structures' });
const chargeId = validateIds({ id: 'student_charges' });
const discountId = validateIds({ id: 'student_discounts' });
const paymentId = validateIds({ id: 'payments' });
// Finance (M8): admin full access, principal view only; teachers and students none.
// Parents see their own children's fees through /api/parent.

// Fee structures (G4) and generating charges
router.get   ('/fee-structures',              schoolLeaders, C.listFeeStructures);
router.post  ('/fee-structures',              adminOnly, validateBodyIds({ academic_year_id: 'academic_years' }), C.createFeeStructure);
router.put   ('/fee-structures/:id',          adminOnly, feeId, C.updateFeeStructure);
router.delete('/fee-structures/:id',          adminOnly, feeId, C.deleteFeeStructure);
router.get   ('/fee-structures/:id/generate', adminOnly, feeId, C.generateCharges);   // preview
router.post  ('/fee-structures/:id/generate', adminOnly, feeId, C.generateCharges);

// Charges
router.get ('/charges',            schoolLeaders, C.listCharges);
router.post('/charges',            adminOnly, validateBodyIds({ student_id: 'students', academic_year_id: 'academic_years' }), C.createCharge);
router.post('/charges/:id/waive',  adminOnly, chargeId, C.waiveCharge);

// Discounts (D22)
router.get   ('/discounts',     schoolLeaders, C.listDiscounts);
router.post  ('/discounts',     adminOnly, validateBodyIds({ student_id: 'students', fee_structure_id: 'fee_structures' }), C.createDiscount);
router.put   ('/discounts/:id', adminOnly, discountId, C.updateDiscount);
router.delete('/discounts/:id', adminOnly, discountId, C.deleteDiscount);

// Payments (receipts)
router.post('/payments',             adminOnly,     validateBodyIds({ student_id: 'students' }), C.recordPayment);
router.get ('/payments',             schoolLeaders, C.getPayments);
router.get ('/payments/:id',         schoolLeaders, paymentId, C.getPayment);
router.post('/payments/:id/reverse', adminOnly,     paymentId, C.reversePayment);

// Reports
router.get ('/summary',               schoolLeaders, C.getFinanceSummary);
router.get ('/outstanding',           schoolLeaders, C.getOutstanding);
router.get ('/student/:studentId',    schoolLeaders, checkIds, C.getStudentBalance);

module.exports = router;
