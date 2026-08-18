// src/routes/academicYear.routes.js
const express = require('express');
const router  = express.Router();
const {
  getAcademicYears, getCurrentYear,
  createAcademicYear, updateAcademicYear,
  activateYear, getYearStats, promoteStudents,
} = require('../controllers/academicYear.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { adminOnly }    = require('../middleware/role.middleware');

router.use(authenticate);

router.get ('/',              adminOnly, getAcademicYears);
router.get ('/current',       adminOnly, getCurrentYear);
router.post('/',              adminOnly, createAcademicYear);
router.put ('/:id',           adminOnly, updateAcademicYear);
router.post('/:id/activate',  adminOnly, activateYear);
router.get ('/:id/stats',     adminOnly, getYearStats);
router.post('/:id/promote',   adminOnly, promoteStudents);

module.exports = router;
