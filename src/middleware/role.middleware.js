// src/middleware/role.middleware.js
// ============================================================
// This middleware runs AFTER authenticate.
// It checks: "Does this user's role allow them here?"
//
// Usage — restrict a route to admins only:
//   router.post('/students', authenticate, authorize('admin'), createStudent);
//
// Usage — allow multiple roles:
//   router.get('/grades', authenticate, authorize('admin','teacher'), getGrades);
// ============================================================

const { sendError } = require('../utils/response');

/**
 * authorize — restricts route access to specific roles.
 * @param {...string} roles - Allowed roles: 'admin', 'teacher', 'student', 'parent'
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    // req.user is set by authenticate middleware above
    if (!req.user) {
      return sendError(res, 'Not authenticated.', 401);
    }

    if (!roles.includes(req.user.role)) {
      return sendError(
        res,
        `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`,
        403
      );
    }

    next(); // Role is allowed — continue
  };
};

/**
 * Shortcuts for common role combinations
 */
const adminOnly          = authorize('admin');
const teacherOrAdmin     = authorize('admin', 'teacher');
const allStaff           = authorize('admin', 'teacher');
const allAuthenticated   = authorize('admin', 'teacher', 'student', 'parent');

module.exports = {
  authorize,
  adminOnly,
  teacherOrAdmin,
  allStaff,
  allAuthenticated,
};
