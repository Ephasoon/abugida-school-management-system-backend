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
const { adminOnly, teacherOrAdmin } = require('../middleware/role.middleware');

router.use(authenticate);

// Read routes — teachers + admins
router.get('/upcoming',          teacherOrAdmin, getUpcoming);
router.get('/calendar',          teacherOrAdmin, getCalendar);
router.get('/class/:classId',    teacherOrAdmin, getClassExams);
router.get('/',                  teacherOrAdmin, getAllScheduled);

// Write routes — admin only
router.post('/',    adminOnly, scheduleExam);
router.put('/:id',  adminOnly, updateSchedule);
router.delete('/:id', adminOnly, cancelExam);

module.exports = router;
