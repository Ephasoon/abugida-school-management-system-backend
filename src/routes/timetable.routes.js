// src/routes/timetable.routes.js
const express  = require('express');
const router   = express.Router();
const {
  createSlot,
  getClassTimetable,
  getTeacherTimetable,
  updateSlot,
  deleteSlot,
  copyTimetable,
  getConflicts,
  getClasses,
  getSubjects,
} = require('../controllers/timetable.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { adminOnly, schoolLeaders, allStaff, allAuthenticated } = require('../middleware/role.middleware');
const { requireClassAccess, requireOwnTeacher } = require('../middleware/studentAccess.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');

router.use(authenticate);

const checkIds = validateIds({ id: 'timetable' });   // malformed/unknown ids -> 404 (after role + access checks)

// Reference data
router.get('/classes',             allStaff, getClasses);
router.get('/subjects',            allStaff, getSubjects);

// Timetable views
router.get('/class/:classId',      allAuthenticated, requireClassAccess('classId'), checkIds, getClassTimetable);
router.get('/teacher/:teacherId',  allStaff, requireOwnTeacher('teacherId'), checkIds, getTeacherTimetable);   // ?academic_year_id=
router.get('/conflicts',           schoolLeaders, getConflicts);   // ?class_id=

// Manage slots
router.post('/copy', adminOnly, validateBodyIds({ from_class_id: 'classes', to_class_id: 'classes' }), copyTimetable);
router.post('/',     adminOnly, validateBodyIds({ class_id: 'classes', subject_id: 'subjects', teacher_id: 'teachers' }), createSlot);
router.put('/:id',   adminOnly, checkIds, validateBodyIds({ subject_id: 'subjects', teacher_id: 'teachers' }), updateSlot);
router.delete('/:id',adminOnly, checkIds, deleteSlot);

module.exports = router;
