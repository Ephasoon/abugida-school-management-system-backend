// src/utils/sessions.js
// ============================================================
// Refresh-token sessions. Each refresh token carries a random jti;
// only sha256(jti) is stored in refresh_tokens.
//
//   createSession(user)            → signed refresh token (row inserted)
//   findActiveSession(token)       → session row, or null if invalid/revoked/expired
//   revokeSession(token)           → revoke one session (logout)
//   revokeAllSessions(userId, q)   → revoke every session (password change, disable)
//   setUserActive(userId, active, q) → enable/disable login; disabling revokes sessions
//
// Functions taking `q` accept a pg client so they can join a transaction.
// ============================================================

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');
const { generateRefreshToken, verifyRefreshToken } = require('./jwt');

const hashJti = (jti) => crypto.createHash('sha256').update(String(jti)).digest('hex');

const createSession = async (user, q = db) => {
  const jti   = crypto.randomUUID();
  const token = generateRefreshToken(user, jti);
  const { exp } = jwt.decode(token);
  await q.query(
    `INSERT INTO refresh_tokens (user_id, jti_hash, expires_at)
     VALUES ($1, $2, to_timestamp($3))`,
    [user.id, hashJti(jti), exp]
  );
  return token;
};

// Returns { session, decoded } or null. Never throws for bad tokens.
const findActiveSession = async (token) => {
  let decoded;
  try { decoded = verifyRefreshToken(token); } catch { return null; }
  if (!decoded.jti) return null; // issued before sessions existed
  const { rows } = await db.query(
    `SELECT id, user_id FROM refresh_tokens
     WHERE jti_hash = $1 AND user_id = $2
       AND revoked_at IS NULL AND expires_at > NOW()`,
    [hashJti(decoded.jti), decoded.id]
  );
  return rows[0] ? { session: rows[0], decoded } : null;
};

// Logout: revoke just this token. Expired-but-signed tokens are still revoked.
const revokeSession = async (token) => {
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET, { ignoreExpiration: true }); }
  catch { return; }
  if (!decoded.jti) return;
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE jti_hash = $1 AND revoked_at IS NULL`,
    [hashJti(decoded.jti)]
  );
};

const revokeAllSessions = async (userId, q = db) => {
  await q.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
};

const setUserActive = async (userId, active, q = db) => {
  if (!userId) return;
  await q.query(
    'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2',
    [!!active, userId]
  );
  if (!active) await revokeAllSessions(userId, q);
};

module.exports = {
  createSession, findActiveSession, revokeSession, revokeAllSessions, setUserActive,
};
