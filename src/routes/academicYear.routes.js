// src/routes/academicYear.routes.js
const express = require('express');
const router  = express.Router();
const {
  getAcademicYears, getCurrentYear,
  createAcademicYear, updateAcademicYear,
  activateYear, deleteAcademicYear, getYearStats, promoteStudents,
} = require('../controllers/academicYear.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly, schoolLeaders } = require('../middleware/role.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');

router.use(authenticate);

const checkIds = validateIds({ id: 'academic_years' });   // malformed/unknown ids -> 404 (after role + access checks)

router.get ('/',              schoolLeaders, getAcademicYears);
router.get ('/current',       schoolLeaders, getCurrentYear);
router.post('/',              adminOnly, createAcademicYear);
router.put ('/:id',           adminOnly, checkIds, updateAcademicYear);
router.post('/:id/activate',  adminOnly, checkIds, activateYear);
router.delete('/:id',          adminOnly, checkIds, deleteAcademicYear);
router.get ('/:id/stats',     schoolLeaders, checkIds, getYearStats);
router.post('/:id/promote',   adminOnly, checkIds, validateBodyIds({ from_year_id: 'academic_years' }), promoteStudents);

module.exports = router;
