// src/middleware/studentAccess.middleware.js
// ============================================================
// Record-level access to a single student's data.
//   admin, teacher → any student (role checks happen in the route)
//   student        → only their own record (students.user_id)
//   parent         → only children linked in student_parents
//
// Usage (after authenticate + authorize):
//   router.get('/student/:studentId', authorize(...), requireStudentAccess('studentId'), handler);
// ============================================================

const db                  = require('../config/db');
const { sendError }       = require('../utils/response');
const { sendServerError } = require('../utils/errors');

const STAFF_ROLES = ['admin', 'teacher'];

/**
 * canAccessStudent — true if `user` may read data for `studentId`.
 * Comparing id::text means a malformed id simply matches nothing.
 */
const canAccessStudent = async (user, studentId) => {
  if (STAFF_ROLES.includes(user.role)) return true;

  if (user.role === 'student') {
    const { rows } = await db.query(
      'SELECT 1 FROM students WHERE id::text = $1 AND user_id = $2',
      [String(studentId), user.id]
    );
    return rows.length > 0;
  }

  if (user.role === 'parent') {
    const { rows } = await db.query(
      `SELECT 1 FROM student_parents sp
       JOIN parents p ON p.id = sp.parent_id
       WHERE sp.student_id::text = $1 AND p.user_id = $2`,
      [String(studentId), user.id]
    );
    return rows.length > 0;
  }

  return false;
};

const requireStudentAccess = (paramName = 'studentId') => async (req, res, next) => {
  try {
    if (await canAccessStudent(req.user, req.params[paramName])) return next();
    return sendError(res, 'Access denied. You can only view your own records.', 403);
  } catch (err) {
    return sendServerError(res, err, 'Server error while checking access.');
  }
};

module.exports = { canAccessStudent, requireStudentAccess };
