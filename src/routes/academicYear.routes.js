// src/routes/academicYear.routes.js
const express = require('express');
const router  = express.Router();
const {
  getAcademicYears, getCurrentYear,
  createAcademicYear, updateAcademicYear,
  activateYear, deleteAcademicYear, getYearStats,
} = require('../controllers/academicYear.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly, schoolLeaders } = require('../middleware/role.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');
const { copyClasses } = require('../controllers/class.controller');
const { previewPromotion, applyPromotion } = require('../controllers/promotion.controller');

router.use(authenticate);

const checkIds = validateIds({ id: 'academic_years' });   // malformed/unknown ids -> 404 (after role + access checks)

router.get ('/',              schoolLeaders, getAcademicYears);
router.get ('/current',       schoolLeaders, getCurrentYear);
router.post('/',              adminOnly, createAcademicYear);
router.put ('/:id',           adminOnly, checkIds, updateAcademicYear);
router.post('/:id/activate',  adminOnly, checkIds, activateYear);
router.delete('/:id',          adminOnly, checkIds, deleteAcademicYear);
router.post('/:id/copy-classes', adminOnly, checkIds, validateBodyIds({ from_year_id: 'academic_years' }), copyClasses);
router.get ('/:id/stats',     schoolLeaders, checkIds, getYearStats);
// Promotion (M7a): preview first (nothing written), then apply with confirm_count
const promotionIds = validateBodyIds({ from_year_id: 'academic_years', 'exclude[]': 'students' });
router.post('/:id/promotion-preview', adminOnly, checkIds, promotionIds, previewPromotion);
router.post('/:id/promote',           adminOnly, checkIds, promotionIds, applyPromotion);

module.exports = router;
