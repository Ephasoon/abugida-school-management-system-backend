// src/utils/jwt.js
// ============================================================
// This file handles everything related to JWT tokens.
//
// What is a JWT token?
// Think of it like a digital ID card. When a user logs in,
// we give them a token. They show that token on every request
// to prove who they are — without needing to log in again.
//
// We use TWO tokens:
//   1. Access Token  — short-lived (15 min). Used on every request.
//   2. Refresh Token — long-lived (7 days). Used ONLY to get a new access token.
// ============================================================

const jwt = require('jsonwebtoken');

/**
 * Generate a short-lived access token.
 * Contains the user's id, email, and role.
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id:    user.id,
      email: user.email,
      role:  user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

/**
 * Generate a long-lived refresh token.
 * Contains only the user's id (minimal data for security).
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

/**
 * Verify an access token.
 * Returns the decoded payload, or throws an error if invalid/expired.
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

/**
 * Verify a refresh token.
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
