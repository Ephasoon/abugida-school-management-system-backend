// src/routes/dashboard.routes.js
// Role dashboards. /api/analytics stays for the old frontend.
const express = require('express');
const router  = express.Router();
const { getTeacherDashboard, getSchoolDashboard } = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize, schoolLeaders } = require('../middleware/role.middleware');

router.use(authenticate);

router.get('/teacher', authorize('teacher'), getTeacherDashboard);   // own classes only
router.get('/school',  schoolLeaders, getSchoolDashboard);          // admin + principal, current year (M7)

module.exports = router;
