-- ============================================================
-- Migration 008: timetable + notifications log
-- Timetable: what subject, which class, which teacher, what time.
-- Notifications: audit trail of every SMS/Telegram message sent.
-- ============================================================

CREATE TYPE day_of_week AS ENUM ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday');

-- ── Timetable ────────────────────────────────────────────────
CREATE TABLE timetable (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id    UUID        NOT NULL REFERENCES classes(id)   ON DELETE CASCADE,
  subject_id  UUID        NOT NULL REFERENCES subjects(id)  ON DELETE RESTRICT,
  teacher_id  UUID        REFERENCES teachers(id)           ON DELETE SET NULL,
  day         day_of_week NOT NULL,
  period      SMALLINT    NOT NULL CHECK (period BETWEEN 1 AND 10), -- period number
  start_time  TIME        NOT NULL,
  end_time    TIME        NOT NULL,
  room        VARCHAR(20),  -- Classroom number/name
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),

  -- No two classes can use same room at same time
  UNIQUE (class_id, day, period)
);

CREATE INDEX idx_timetable_class   ON timetable(class_id);
CREATE INDEX idx_timetable_teacher ON timetable(teacher_id);
CREATE INDEX idx_timetable_day     ON timetable(day);


-- ── Notifications Log ────────────────────────────────────────
-- Every SMS and Telegram message is logged here.
-- Useful for: auditing, retry logic, and troubleshooting.
CREATE TYPE notification_channel AS ENUM ('sms', 'telegram', 'email');
CREATE TYPE notification_status  AS ENUM ('pending', 'sent', 'failed', 'delivered');
CREATE TYPE notification_type    AS ENUM (
  'absence_alert',
  'grade_update',
  'fee_reminder',
  'announcement',
  'report_ready'
);

CREATE TABLE notifications (
  id           UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel      notification_channel  NOT NULL,
  type         notification_type     NOT NULL,
  recipient    VARCHAR(255)          NOT NULL, -- phone number or telegram_chat_id
  student_id   UUID                  REFERENCES students(id) ON DELETE SET NULL,
  parent_id    UUID                  REFERENCES parents(id)  ON DELETE SET NULL,
  message      TEXT                  NOT NULL,
  status       notification_status   NOT NULL DEFAULT 'pending',
  sent_at      TIMESTAMP,
  error        TEXT,                           -- Store error message if failed
  created_at   TIMESTAMP             NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_student   ON notifications(student_id);
CREATE INDEX idx_notif_status    ON notifications(status);
CREATE INDEX idx_notif_channel   ON notifications(channel);
CREATE INDEX idx_notif_created   ON notifications(created_at);


-- ── Audit Log ────────────────────────────────────────────────
-- Tracks important actions: who did what and when.
-- Useful for security and compliance.
CREATE TABLE audit_logs (
  id          UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID      REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,   -- e.g. "student.created", "grade.updated"
  target_type VARCHAR(50),             -- e.g. "student", "grade"
  target_id   UUID,                    -- The ID of the affected record
  old_data    JSONB,                   -- Previous state (for updates)
  new_data    JSONB,                   -- New state
  ip_address  VARCHAR(45),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user   ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id);
