-- ============================================================
-- Migration 019: promotion runs (M7a, safe promotion)
-- One row per applied promotion. from_year_id is unique, so the
-- students of a year can be promoted only once. The per-student
-- detail is in the audit entry (students.promoted).
-- Nothing in existing rows changes.
-- Rollback: DROP TABLE promotion_runs (no other object uses it).
-- ============================================================

CREATE TABLE promotion_runs (
  id            UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  from_year_id  UUID      NOT NULL UNIQUE REFERENCES academic_years(id) ON DELETE RESTRICT,
  to_year_id    UUID      NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  run_by        UUID      REFERENCES users(id) ON DELETE SET NULL,
  run_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  promoted      INTEGER   NOT NULL DEFAULT 0,
  repeated      INTEGER   NOT NULL DEFAULT 0,
  graduated     INTEGER   NOT NULL DEFAULT 0,
  CHECK (from_year_id <> to_year_id)
);

CREATE INDEX idx_promotion_runs_to ON promotion_runs(to_year_id);
