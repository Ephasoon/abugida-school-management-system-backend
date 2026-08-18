-- ============================================================
-- Migration 005: attendance
-- Daily attendance per student, per class, marked by a teacher.
-- One record per student per day — enforced by UNIQUE constraint.
-- ============================================================

CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');

CREATE TABLE attendance (
  id          UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id  UUID              NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  class_id    UUID              NOT NULL REFERENCES classes(id)   ON DELETE RESTRICT,
  marked_by   UUID              REFERENCES teachers(id)           ON DELETE SET NULL,
  date        DATE              NOT NULL,
  status      attendance_status NOT NULL,
  note        TEXT,             -- Reason for absence or tardiness
  sms_sent    BOOLEAN           NOT NULL DEFAULT FALSE, -- Tracks if parent was notified
  created_at  TIMESTAMP         NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP         NOT NULL DEFAULT NOW(),

  -- A student can only have ONE attendance record per day
  UNIQUE (student_id, date)
);

-- These indexes make attendance queries fast.
-- Most common queries: "attendance for this class today" and
-- "attendance history for this student this month"
CREATE INDEX idx_attendance_student    ON attendance(student_id);
CREATE INDEX idx_attendance_class_date ON attendance(class_id, date);
CREATE INDEX idx_attendance_date       ON attendance(date);
CREATE INDEX idx_attendance_status     ON attendance(status);
