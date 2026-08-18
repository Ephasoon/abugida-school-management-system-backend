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
const { adminOnly, teacherOrAdmin } = require('../middleware/role.middleware');

router.use(authenticate);

// Reference data
router.get('/classes',             teacherOrAdmin, getClasses);
router.get('/subjects',            teacherOrAdmin, getSubjects);

// Timetable views
router.get('/class/:classId',      teacherOrAdmin, getClassTimetable);
router.get('/teacher/:teacherId',  teacherOrAdmin, getTeacherTimetable);

// Manage slots
router.post('/',     adminOnly, createSlot);
router.put('/:id',   adminOnly, updateSlot);
router.delete('/:id',adminOnly, deleteSlot);

module.exports = router;
