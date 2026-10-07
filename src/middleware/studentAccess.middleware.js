// src/middleware/studentAccess.middleware.js
// ============================================================
// Record-level access, based on utils/scope.js (docs/PERMISSIONS.md):
//   requireStudentAccess(param) — one student's data
//   requireClassAccess(param)   — one class's data
//   requireOwnTeacher(param)    — a teacher's own profile/timetable
// Admin and principal pass; teachers, students and parents are scoped.
//
// Usage (after authenticate + a role check):
//   router.get('/student/:studentId', anyRole, requireStudentAccess('studentId'), handler);
// ============================================================

const db                  = require('../config/db');
const { sendError }       = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { canAccessStudent, canAccessClass, isSchoolWide } = require('../utils/scope');

// Builds a middleware from an async (req) => boolean check
const guard = (check, deniedMessage) => async (req, res, next) => {
  try {
    if (await check(req)) return next();
    return sendError(res, deniedMessage, 403);
  } catch (err) {
    return sendServerError(res, err, 'Server error while checking access.');
  }
};

const requireStudentAccess = (paramName = 'studentId') => guard(
  req => canAccessStudent(req.user, req.params[paramName]),
  'Access denied. You can only view students you are allowed to see.'
);

// Reads the class id from the route params, or from the body (e.g. class_id when marking attendance)
const requireClassAccess = (paramName = 'classId', { from = 'params' } = {}) => guard(
  req => canAccessClass(req.user, req[from]?.[paramName]),
  'Access denied. You can only access your own classes.'
);

const requireOwnTeacher = (paramName = 'id') => guard(async (req) => {
  if (isSchoolWide(req.user)) return true;
  if (req.user.role !== 'teacher') return false;
  const { rows } = await db.query(
    'SELECT 1 FROM teachers WHERE id::text = $1 AND user_id = $2',
    [String(req.params[paramName]), req.user.id]
  );
  return rows.length > 0;
}, 'Access denied. Teachers can only view their own profile.');

module.exports = { canAccessStudent, requireStudentAccess, requireClassAccess, requireOwnTeacher };
