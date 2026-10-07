// src/routes/analytics.routes.js
const express = require('express');
const router  = express.Router();
const {
  getOverview, getStudentAnalytics,
  getAttendanceAnalytics, getGradeAnalytics, getFinanceAnalytics,
} = require('../controllers/analytics.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { schoolLeaders } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(schoolLeaders);   // whole-school dashboard: admin + principal (read-only)

router.get('/overview',   getOverview);
router.get('/students',   getStudentAnalytics);
router.get('/attendance', getAttendanceAnalytics);
router.get('/grades',     getGradeAnalytics);
router.get('/finance',    getFinanceAnalytics);

module.exports = router;
