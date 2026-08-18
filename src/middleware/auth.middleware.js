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

const { verifyAccessToken } = require('../utils/jwt');
const { sendError }         = require('../utils/response');

/**
 * authenticate — verifies the JWT token on every protected request.
 */
const authenticate = (req, res, next) => {
  // The token comes in the Authorization header, formatted as:
  //   "Bearer eyJhbGciOiJIUzI1NiIs..."
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'Access denied. No token provided.', 401);
  }

  // Extract the token part (remove "Bearer ")
  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded; // { id, email, role }
    next();             // Token is valid — continue to the route handler
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendError(res, 'Token expired. Please refresh your session.', 401);
    }
    return sendError(res, 'Invalid token.', 401);
  }
};

module.exports = { authenticate };
