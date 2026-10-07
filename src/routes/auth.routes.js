// src/routes/auth.routes.js
// ============================================================
// Maps URLs to the right controller function.
// Think of routes as a switchboard — the URL comes in,
// the router directs it to the correct handler.
// ============================================================

const express    = require('express');
const router     = express.Router();
const {
  login,
  refresh,
  logout,
  getMe,
  changePassword,
}                = require('../controllers/auth.controller');
const { authenticate,
        authenticateAllowPasswordChange } = require('../middleware/auth.middleware');
const { loginLimiter } = require('../middleware/rateLimit.middleware');

// Public routes — no token needed
router.post('/login',   loginLimiter, login);
router.post('/refresh', refresh);
router.post('/logout',  logout);

// Protected routes — must be logged in
router.get ('/me',              authenticate, getMe);
router.post('/change-password', authenticateAllowPasswordChange, changePassword);

module.exports = router;
