// src/routes/attendance.routes.js
// ============================================================
// All attendance routes — all protected by JWT.
// Teachers can mark and view. Admins can do everything.
// Students/parents can only view their own records.
// ============================================================

const express  = require('express');
const router   = express.Router();
const {
  markAttendance,
  getClassAttendance,
  updateAttendance,
  getStudentAttendance,
  getClassReport,
}              = require('../controllers/attendance.controller');
const { authenticate }                   = require('../middleware/auth.middleware');
const { adminOnly, teacherOrAdmin, authorize } = require('../middleware/role.middleware');
const { requireStudentAccess } = require('../middleware/studentAccess.middleware');

router.use(authenticate);

// Mark attendance for a class (teachers + admins)
router.post('/',                        teacherOrAdmin,  markAttendance);

// Correct a single record (admin only)
router.put('/:id',                      adminOnly,       updateAttendance);

// Student's own attendance history (all roles)
router.get('/student/:studentId',       authorize('admin','teacher','student','parent'), requireStudentAccess('studentId'), getStudentAttendance);

// Monthly class report (teachers + admins)
router.get('/report/:classId',          teacherOrAdmin,  getClassReport);

// Registered last: this pattern would otherwise swallow /student/:id and /report/:id
// Get attendance for a class on a date (teachers + admins)
router.get('/:classId/:date',           teacherOrAdmin,  getClassAttendance);

module.exports = router;
