// src/routes/teacher.routes.js
const express  = require('express');
const router   = express.Router();
const {
  createTeacher, getTeachers, getTeacherById,
  updateTeacher, assignSubjects, assignClass, removeClassAssignment, getAllSubjects,
} = require('../controllers/teacher.controller');
const { authenticate }        = require('../middleware/auth.middleware');
const { adminOnly, teacherOrAdmin } = require('../middleware/role.middleware');

router.use(authenticate);

router.get ('/subjects',          teacherOrAdmin, getAllSubjects);  // All subjects list
router.get ('/',                  teacherOrAdmin, getTeachers);     // List teachers
router.post('/',                  adminOnly,      createTeacher);   // Add teacher
router.get ('/:id',               teacherOrAdmin, getTeacherById);  // Teacher profile
router.put ('/:id',               adminOnly,      updateTeacher);   // Update teacher
router.post('/:id/subjects',      adminOnly,      assignSubjects);  // Assign subjects
router.post('/:id/classes',       adminOnly,      assignClass);     // Assign class
router.delete('/:id/classes/:classId/:subjectId', adminOnly, removeClassAssignment); // Unassign

module.exports = router;
