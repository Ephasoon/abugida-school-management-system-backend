-- ============================================================
-- Migration 011: exam_schedules
-- Extra scheduling details for an exam (time, room, instructions).
-- examSchedule.controller.js wrote here, but the table never existed
-- and the error was silently swallowed, so these details were lost.
-- ============================================================

CREATE TABLE exam_schedules (
  exam_id      UUID        PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE,
  start_time   TIME,
  end_time     TIME,
  room         VARCHAR(50),
  instructions TEXT,
  created_at   TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT exam_schedule_times CHECK (
    start_time IS NULL OR end_time IS NULL OR end_time > start_time
  )
);
