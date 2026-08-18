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
const { authenticate } = require('../middleware/auth.middleware');

// Public routes — no token needed
router.post('/login',   login);
router.post('/refresh', refresh);
router.post('/logout',  logout);

// Protected routes — must be logged in
router.get ('/me',              authenticate, getMe);
router.post('/change-password', authenticate, changePassword);

module.exports = router;
