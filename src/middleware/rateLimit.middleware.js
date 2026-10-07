// src/middleware/rateLimit.middleware.js
// ============================================================
// Login brute-force protection: 5 failed attempts per 15 minutes
// for each IP + email pair. Successful logins are not counted.
// ============================================================

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit:    5,
  skipSuccessfulRequests: true, // only 4xx/5xx responses count as attempts
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    return `${ipKeyGenerator(req.ip)}|${email}`;
  },
  handler: (req, res, next, options) => res.status(options.statusCode).json({
    success: false,
    message: 'Too many failed login attempts. Please try again in 15 minutes.',
  }),
});

module.exports = { loginLimiter };
