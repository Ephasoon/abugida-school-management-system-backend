-- ============================================================
-- Migration 001: users
-- The central authentication table.
-- Every person in the system (admin, teacher, student, parent)
-- has exactly ONE row here for login credentials.
-- Their actual profile details live in their own table.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Enables UUID generation

CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'student', 'parent');

CREATE TABLE users (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,              -- bcrypt hashed, never plain text
  role          user_role     NOT NULL,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE, -- soft disable without deleting
  last_login    TIMESTAMP,
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Index on email because every login query searches by email
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role  ON users(role);

-- ── Seed: Default Admin Account ──────────────────────────────
-- Password is 'Admin@1234' — CHANGE THIS after first login!
-- The hash below was generated with bcrypt at 12 rounds.
INSERT INTO users (email, password_hash, role) VALUES (
  'admin@asms.et',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBpj2v.5MWGV3.',
  'admin'
);
