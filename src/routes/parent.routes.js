// src/routes/parent.routes.js
const express  = require('express');
const router   = express.Router();
const {
  getParentProfile, getChildren, getChildSummary,
  getChildGrades, getChildAttendance, getChildFees, getChildTimetable,
} = require('../controllers/parent.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize }    = require('../middleware/role.middleware');

router.use(authenticate);

// All parent routes — only parents (and admins for testing)
const parentOrAdmin = authorize('parent', 'admin');

router.get('/profile',                       parentOrAdmin, getParentProfile);
router.get('/children',                      parentOrAdmin, getChildren);
router.get('/child/:studentId/summary',      parentOrAdmin, getChildSummary);
router.get('/child/:studentId/grades',       parentOrAdmin, getChildGrades);
router.get('/child/:studentId/attendance',   parentOrAdmin, getChildAttendance);
router.get('/child/:studentId/fees',         parentOrAdmin, getChildFees);
router.get('/child/:studentId/timetable',    parentOrAdmin, getChildTimetable);

module.exports = router;
