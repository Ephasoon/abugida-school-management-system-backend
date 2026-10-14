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
const { validateIds } = require('../middleware/validateIds.middleware');

router.use(authenticate);

const checkIds = validateIds({ id: 'timetable' });   // malformed/unknown ids -> 404 (after role + access checks)

// Reference data
router.get('/classes',             allStaff, getClasses);
router.get('/subjects',            allStaff, getSubjects);

// Timetable views
router.get('/class/:classId',      allAuthenticated, requireClassAccess('classId'), checkIds, getClassTimetable);
router.get('/teacher/:teacherId',  allStaff, requireOwnTeacher('teacherId'), checkIds, getTeacherTimetable);

// Manage slots
router.post('/',     adminOnly, createSlot);
router.put('/:id',   adminOnly, checkIds, updateSlot);
router.delete('/:id',adminOnly, checkIds, deleteSlot);

module.exports = router;
