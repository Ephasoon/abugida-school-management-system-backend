// src/routes/examSchedule.routes.js
const express = require('express');
const router  = express.Router();
const {
  scheduleExam,
  getAllScheduled,
  getUpcoming,
  getCalendar,
  getClassExams,
  updateSchedule,
  cancelExam,
} = require('../controllers/examSchedule.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { adminOnly, teacherOrAdmin, allAuthenticated } = require('../middleware/role.middleware');
const { requireClassAccess } = require('../middleware/studentAccess.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');

router.use(authenticate);

const checkIds = validateIds({ id: 'exams' });   // malformed/unknown ids -> 404 (after role + access checks)

// Read routes — every role, limited to the classes the user may see
router.get('/upcoming',          allAuthenticated, getUpcoming);
router.get('/calendar',          allAuthenticated, getCalendar);
router.get('/class/:classId',    allAuthenticated, requireClassAccess('classId'), checkIds, getClassExams);
router.get('/',                  allAuthenticated, getAllScheduled);

// Write routes — admin only
router.post('/',    teacherOrAdmin, validateBodyIds({ class_id: 'classes', subject_id: 'subjects' }), scheduleExam);   // teacher: own class + subject only
router.put('/:id',  adminOnly, checkIds, updateSchedule);
router.delete('/:id', adminOnly, checkIds, cancelExam);

module.exports = router;
