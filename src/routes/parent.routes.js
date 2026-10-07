// src/routes/parent.routes.js
const express  = require('express');
const router   = express.Router();
const {
  getParentProfile, getChildren, getChildSummary,
  getChildGrades, getChildAttendance, getChildFees, getChildTimetable,
} = require('../controllers/parent.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { parentOnly }   = require('../middleware/role.middleware');

router.use(authenticate);

// Parent portal — parents only; every child route checks the parent-child link

router.get('/profile',                       parentOnly, getParentProfile);
router.get('/children',                      parentOnly, getChildren);
router.get('/child/:studentId/summary',      parentOnly, getChildSummary);
router.get('/child/:studentId/grades',       parentOnly, getChildGrades);
router.get('/child/:studentId/attendance',   parentOnly, getChildAttendance);
router.get('/child/:studentId/fees',         parentOnly, getChildFees);
router.get('/child/:studentId/timetable',    parentOnly, getChildTimetable);

module.exports = router;
