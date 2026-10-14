// src/routes/student.routes.js
// ============================================================
// Maps all student-related URLs to their controller functions.
// All routes here are protected — you must be logged in.
// Role restrictions:
//   - Create/Update/Delete → admin only
//   - Read → admin + teacher
//   - Own profile → student can read their own
// ============================================================

const express    = require('express');
const router     = express.Router();
const {
  createStudent,
  getStudents,
  getStudentById,
  updateStudent,
  archiveStudent,
  getStudentSummary,
}                = require('../controllers/student.controller');
const { authenticate }           = require('../middleware/auth.middleware');
const { adminOnly, allStaff, allAuthenticated } = require('../middleware/role.middleware');
const { requireStudentAccess } = require('../middleware/studentAccess.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');

// All routes below require a valid JWT token
router.use(authenticate);

const checkIds = validateIds({ id: 'students' });   // malformed/unknown ids -> 404 (after role + access checks)

// ── List & Create ────────────────────────────────────────────
router.get ('/'         , allStaff,       getStudents);   // teachers: own classes only   // GET  /api/students
router.post('/'         , adminOnly,      validateBodyIds({ class_id: 'classes' }), createStudent); // POST /api/students

// ── Single Student ───────────────────────────────────────────
router.get ('/:id'         , allAuthenticated, requireStudentAccess('id'), checkIds, getStudentById);   // GET    /api/students/:id
router.put ('/:id'         , adminOnly,                  checkIds, validateBodyIds({ class_id: 'classes' }), updateStudent);    // PUT    /api/students/:id
router.delete('/:id'       , adminOnly,                  checkIds, archiveStudent);   // DELETE /api/students/:id
router.get ('/:id/summary' , allAuthenticated, requireStudentAccess('id'), checkIds, getStudentSummary); // GET /api/students/:id/summary

module.exports = router;
