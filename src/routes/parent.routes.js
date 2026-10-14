// src/routes/parent.routes.js
const express  = require('express');
const router   = express.Router();
const {
  getParentProfile, getChildren, getChildSummary,
  getChildGrades, getChildAttendance, getChildFees, getChildTimetable, getFamilyFees,
} = require('../controllers/parent.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { parentOnly }   = require('../middleware/role.middleware');
const { requireStudentAccess } = require('../middleware/studentAccess.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');

router.use(authenticate);

const checkIds = validateIds();   // malformed/unknown ids -> 404 (after role + access checks)

// Parent portal — parents only; every child route checks the parent-child link

router.get('/profile',                       parentOnly, getParentProfile);
router.get('/children',                      parentOnly, getChildren);
router.get('/fees',                          parentOnly, getFamilyFees);   // all children + family total
router.get('/child/:studentId/summary',      parentOnly, requireStudentAccess('studentId'), checkIds, getChildSummary);
router.get('/child/:studentId/grades',       parentOnly, requireStudentAccess('studentId'), checkIds, getChildGrades);
router.get('/child/:studentId/attendance',   parentOnly, requireStudentAccess('studentId'), checkIds, getChildAttendance);
router.get('/child/:studentId/fees',         parentOnly, requireStudentAccess('studentId'), checkIds, getChildFees);
router.get('/child/:studentId/timetable',    parentOnly, requireStudentAccess('studentId'), checkIds, getChildTimetable);

module.exports = router;
