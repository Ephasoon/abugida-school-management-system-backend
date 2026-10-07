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
const { adminOnly, allAuthenticated } = require('../middleware/role.middleware');
const { requireClassAccess } = require('../middleware/studentAccess.middleware');

router.use(authenticate);

// Read routes — every role, limited to the classes the user may see
router.get('/upcoming',          allAuthenticated, getUpcoming);
router.get('/calendar',          allAuthenticated, getCalendar);
router.get('/class/:classId',    allAuthenticated, requireClassAccess('classId'), getClassExams);
router.get('/',                  allAuthenticated, getAllScheduled);

// Write routes — admin only
router.post('/',    adminOnly, scheduleExam);
router.put('/:id',  adminOnly, updateSchedule);
router.delete('/:id', adminOnly, cancelExam);

module.exports = router;
