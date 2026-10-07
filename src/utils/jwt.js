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

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

// Fixed by policy (Phase 0): access tokens live 15 minutes.
// JWT_EXPIRES_IN in .env is intentionally no longer read.
const ACCESS_TOKEN_TTL = '15m';

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
    { expiresIn: ACCESS_TOKEN_TTL }
  );
};

/**
 * Generate a long-lived refresh token.
 * Contains the user's id and a random jti; the jti's hash is stored in
 * refresh_tokens so the token can be revoked (see utils/sessions.js).
 */
const generateRefreshToken = (user, jti = crypto.randomUUID()) => {
  return jwt.sign(
    { id: user.id, jti },
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
