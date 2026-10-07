// src/routes/dashboard.routes.js
// Role dashboards. Admin and principal use /api/analytics (whole school).
const express = require('express');
const router  = express.Router();
const { getTeacherDashboard } = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize }    = require('../middleware/role.middleware');

router.use(authenticate);

router.get('/teacher', authorize('teacher'), getTeacherDashboard);   // own classes only

module.exports = router;
