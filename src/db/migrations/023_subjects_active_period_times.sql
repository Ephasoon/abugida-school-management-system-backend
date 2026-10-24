-- ============================================================
-- Migration 023: subject status, period times, audit log paging (M7: G3, G8, timetable)
--
-- subjects.is_active: a subject in use (timetable, teacher subjects or classes, exams) is
--   deactivated instead of deleted. Inactive subjects keep their data but are refused for
--   new slots, assignments and exams. Every existing subject stays active.
-- school_settings.period_times: start and end of periods 1-8, prefilled in the timetable
--   grid (each slot keeps its own times). Default: the old timetable page's hours.
-- idx_audit_created: the audit log viewer pages newest first and filters by date.
-- Nothing in existing rows changes.
-- Rollback: ALTER TABLE subjects DROP COLUMN is_active;
--   DELETE FROM school_settings WHERE key = 'period_times'; DROP INDEX idx_audit_created.
-- ============================================================

ALTER TABLE subjects ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO school_settings (key, value) VALUES
  ('period_times', '[
    {"period": 1, "start": "08:00", "end": "09:00"},
    {"period": 2, "start": "09:00", "end": "10:00"},
    {"period": 3, "start": "10:00", "end": "11:00"},
    {"period": 4, "start": "11:00", "end": "12:00"},
    {"period": 5, "start": "13:00", "end": "14:00"},
    {"period": 6, "start": "14:00", "end": "15:00"},
    {"period": 7, "start": "15:00", "end": "16:00"},
    {"period": 8, "start": "16:00", "end": "17:00"}
  ]')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
