-- ============================================================
-- Migration 017: display name for accounts without a profile table
-- Principals (and admins) have no teachers/students/parents row, so
-- their name is stored on the user. Shown by GET /api/auth/me.
-- ============================================================

ALTER TABLE users ADD COLUMN display_name VARCHAR(255);
