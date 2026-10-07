// src/middleware/auth.middleware.js
// ============================================================
// This middleware runs BEFORE any protected route handler.
// It checks: "Does this request have a valid token?"
// If yes → allow through. If no → reject immediately.
//
// Usage on any route:
//   router.get('/students', authenticate, getStudents);
//
// The user's data (id, email, role) is attached to req.user
// so every controller can access it without another DB query.
// ============================================================

const db                    = require('../config/db');
const { verifyAccessToken } = require('../utils/jwt');
const { sendError }         = require('../utils/response');

/**
 * Builds the authenticate middleware.
 * Besides verifying the JWT, it reads the user row on every request
 * (primary-key lookup) so that disabling an account or forcing a
 * password change takes effect immediately, not when the token expires.
 *
 * @param {boolean} allowPasswordChange - true only for the route that
 *   lets a user with must_change_password set a new password.
 */
const buildAuthenticate = ({ allowPasswordChange = false } = {}) => async (req, res, next) => {
  // The token comes in the Authorization header, formatted as:
  //   "Bearer eyJhbGciOiJIUzI1NiIs..."
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'Access denied. No token provided.', 401);
  }

  // Extract the token part (remove "Bearer ")
  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendError(res, 'Token expired. Please refresh your session.', 401);
    }
    return sendError(res, 'Invalid token.', 401);
  }

  try {
    const { rows } = await db.query(
      'SELECT id, email, role, is_active, must_change_password FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      return sendError(res, 'Account is disabled or no longer exists.', 401);
    }
    if (user.must_change_password && !allowPasswordChange) {
      return sendError(res, 'You must change your password before continuing.', 403,
        { code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    // Role comes from the database, so a role change applies immediately
    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    console.error('authenticate error:', err);
    return sendError(res, 'Server error.', 500);
  }
};

const authenticate = buildAuthenticate();

// Only for POST /api/auth/change-password
const authenticateAllowPasswordChange = buildAuthenticate({ allowPasswordChange: true });

module.exports = { authenticate, authenticateAllowPasswordChange };
