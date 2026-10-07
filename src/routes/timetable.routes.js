// src/routes/timetable.routes.js
const express  = require('express');
const router   = express.Router();
const {
  createSlot,
  getClassTimetable,
  getTeacherTimetable,
  updateSlot,
  deleteSlot,
  getClasses,
  getSubjects,
} = require('../controllers/timetable.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { adminOnly, allStaff, allAuthenticated } = require('../middleware/role.middleware');
const { requireClassAccess, requireOwnTeacher } = require('../middleware/studentAccess.middleware');

router.use(authenticate);

// Reference data
router.get('/classes',             allStaff, getClasses);
router.get('/subjects',            allStaff, getSubjects);

// Timetable views
router.get('/class/:classId',      allAuthenticated, requireClassAccess('classId'), getClassTimetable);
router.get('/teacher/:teacherId',  allStaff, requireOwnTeacher('teacherId'), getTeacherTimetable);

// Manage slots
router.post('/',     adminOnly, createSlot);
router.put('/:id',   adminOnly, updateSlot);
router.delete('/:id',adminOnly, deleteSlot);

module.exports = router;
