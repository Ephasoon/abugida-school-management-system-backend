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

// All routes below require a valid JWT token
router.use(authenticate);

// ── List & Create ────────────────────────────────────────────
router.get ('/'         , allStaff,       getStudents);   // teachers: own classes only   // GET  /api/students
router.post('/'         , adminOnly,      createStudent); // POST /api/students

// ── Single Student ───────────────────────────────────────────
router.get ('/:id'         , allAuthenticated, requireStudentAccess('id'), getStudentById);   // GET    /api/students/:id
router.put ('/:id'         , adminOnly,                         updateStudent);    // PUT    /api/students/:id
router.delete('/:id'       , adminOnly,                         archiveStudent);   // DELETE /api/students/:id
router.get ('/:id/summary' , allAuthenticated, requireStudentAccess('id'), getStudentSummary); // GET /api/students/:id/summary

module.exports = router;
