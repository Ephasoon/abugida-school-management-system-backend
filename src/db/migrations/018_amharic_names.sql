-- ============================================================
-- Migration 018: optional Amharic names (PHASE2_PLAN D4, §7.3)
-- Nullable columns next to the Latin names. Nothing is copied or
-- changed in existing rows; the Latin names stay required.
--   students: first_name_am, fathers_name_am, last_name_am
--   teachers: first_name_am, last_name_am
--   parents:  full_name_am
-- Rollback: drop the six columns (no other object uses them).
-- ============================================================

ALTER TABLE students
  ADD COLUMN first_name_am   VARCHAR(100),
  ADD COLUMN fathers_name_am VARCHAR(100),
  ADD COLUMN last_name_am    VARCHAR(100);

ALTER TABLE teachers
  ADD COLUMN first_name_am VARCHAR(100),
  ADD COLUMN last_name_am  VARCHAR(100);

ALTER TABLE parents
  ADD COLUMN full_name_am VARCHAR(255);
