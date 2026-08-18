// src/controllers/auth.controller.js
// ============================================================
// This is where the actual login/logout logic lives.
// Controllers receive the request, do the work, send the response.
//
// Endpoints handled here:
//   POST /api/auth/login    → verify credentials → return tokens
//   POST /api/auth/refresh  → verify refresh token → return new access token
//   POST /api/auth/logout   → clear refresh token cookie
//   GET  /api/auth/me       → return current logged-in user info
// ============================================================

const bcrypt                                   = require('bcryptjs');
const db                                       = require('../config/db');
const { generateAccessToken,
        generateRefreshToken,
        verifyRefreshToken }                   = require('../utils/jwt');
const { sendSuccess, sendError }               = require('../utils/response');

// ── LOGIN ────────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Validate input — both fields are required
    if (!email || !password) {
      return sendError(res, 'Email and password are required.', 400);
    }

    // 2. Look up the user by email
    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = rows[0];

    // 3. If user not found OR account is disabled
    if (!user) {
      return sendError(res, 'Invalid email or password.', 401);
    }

    if (!user.is_active) {
      return sendError(res, 'Your account has been disabled. Contact the admin.', 403);
    }

    // 4. Compare the submitted password against the stored hash
    //    bcrypt.compare is safe against timing attacks
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return sendError(res, 'Invalid email or password.', 401);
    }

    // 5. Generate both tokens
    const accessToken  = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // 6. Update last_login timestamp
    await db.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // 7. Store refresh token in a secure HTTP-only cookie.
    //    HTTP-only means JavaScript cannot read it → more secure.
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    });

    // 8. Return the access token and user profile
    return sendSuccess(res, {
      accessToken,
      user: {
        id:    user.id,
        email: user.email,
        role:  user.role,
      },
    }, 'Login successful.');

  } catch (err) {
    console.error('Login error:', err);
    return sendError(res, 'Server error during login.', 500);
  }
};


// ── REFRESH TOKEN ────────────────────────────────────────────
const refresh = async (req, res) => {
  try {
    // Get the refresh token from the cookie
    const token = req.cookies?.refreshToken;

    if (!token) {
      return sendError(res, 'No refresh token. Please log in again.', 401);
    }

    // Verify the refresh token
    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return sendError(res, 'Refresh token expired or invalid. Please log in again.', 401);
    }

    // Get fresh user data from DB (in case role changed since last token)
    const { rows } = await db.query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );

    const user = rows[0];

    if (!user || !user.is_active) {
      return sendError(res, 'User not found or disabled.', 401);
    }

    // Issue a fresh access token
    const accessToken = generateAccessToken(user);

    return sendSuccess(res, { accessToken }, 'Token refreshed.');

  } catch (err) {
    console.error('Refresh error:', err);
    return sendError(res, 'Server error during token refresh.', 500);
  }
};


// ── LOGOUT ───────────────────────────────────────────────────
const logout = (req, res) => {
  // Clear the refresh token cookie
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  return sendSuccess(res, null, 'Logged out successfully.');
};


// ── GET CURRENT USER ─────────────────────────────────────────
// Returns the profile of whoever is currently logged in.
// Protected by authenticate middleware.
const getMe = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         u.id, u.email, u.role, u.last_login, u.created_at,
         -- Get name from the right profile table based on role
         CASE
           WHEN u.role = 'teacher' THEN t.first_name || ' ' || t.last_name
           WHEN u.role = 'student' THEN s.first_name || ' ' || s.last_name
           WHEN u.role = 'parent'  THEN p.full_name
           ELSE 'Administrator'
         END AS full_name
       FROM users u
       LEFT JOIN teachers t ON t.user_id = u.id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN parents  p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (!rows[0]) {
      return sendError(res, 'User not found.', 404);
    }

    return sendSuccess(res, rows[0], 'User profile retrieved.');

  } catch (err) {
    console.error('GetMe error:', err);
    return sendError(res, 'Server error.', 500);
  }
};


// ── CHANGE PASSWORD ──────────────────────────────────────────
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return sendError(res, 'Both current and new password are required.', 400);
    }

    if (newPassword.length < 8) {
      return sendError(res, 'New password must be at least 8 characters.', 400);
    }

    // Get user with current hash
    const { rows } = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return sendError(res, 'Current password is incorrect.', 401);
    }

    // Hash the new password
    const newHash = await bcrypt.hash(newPassword, 12);

    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, req.user.id]
    );

    return sendSuccess(res, null, 'Password changed successfully.');

  } catch (err) {
    console.error('ChangePassword error:', err);
    return sendError(res, 'Server error.', 500);
  }
};

module.exports = { login, refresh, logout, getMe, changePassword };
