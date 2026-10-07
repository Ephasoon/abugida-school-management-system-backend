-- ============================================================
-- Migration 009: auth sessions
--   users.must_change_password — forces a password change before
--     any other route can be used (new teachers, reset accounts).
--   refresh_tokens — one row per issued refresh token. Only a
--     SHA-256 hash of the token's random id (jti) is stored, so a
--     database leak does not expose usable tokens.
-- ============================================================

ALTER TABLE users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE refresh_tokens (
  id          UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti_hash    CHAR(64)   NOT NULL UNIQUE,   -- hex SHA-256 of the token's jti
  expires_at  TIMESTAMP  NOT NULL,
  revoked_at  TIMESTAMP,                    -- NULL = still valid
  created_at  TIMESTAMP  NOT NULL DEFAULT NOW()
);

-- "Revoke all sessions for this user" looks up active tokens by user
CREATE INDEX idx_refresh_tokens_user_active
  ON refresh_tokens(user_id)
  WHERE revoked_at IS NULL;
