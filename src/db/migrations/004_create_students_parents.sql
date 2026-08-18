-- ============================================================
-- Migration 004: students + parents
-- Students reference users and classes (both already exist).
-- Parents reference users and students.
-- ============================================================

CREATE TYPE student_status AS ENUM ('active', 'graduated', 'withdrawn', 'suspended');

CREATE TABLE students (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID           UNIQUE REFERENCES users(id) ON DELETE SET NULL,
                                 -- NULL if student has no login account yet
  class_id        UUID           REFERENCES classes(id) ON DELETE RESTRICT,
  student_number  VARCHAR(20)    NOT NULL UNIQUE, -- e.g. "ASMS-2024-001"
  first_name      VARCHAR(100)   NOT NULL,
  last_name       VARCHAR(100)   NOT NULL,
  fathers_name    VARCHAR(100),                   -- Ethiopian naming convention
  date_of_birth   DATE,
  gender          VARCHAR(10)    CHECK (gender IN ('male', 'female')),
  photo_url       TEXT,
  phone           VARCHAR(20),
  address         TEXT,
  region          VARCHAR(100),                   -- Ethiopian region
  woreda          VARCHAR(100),                   -- Ethiopian sub-district
  previous_school VARCHAR(255),
  enrollment_date DATE           NOT NULL DEFAULT CURRENT_DATE,
  status          student_status NOT NULL DEFAULT 'active',
  notes           TEXT,
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_number   ON students(student_number);
CREATE INDEX idx_students_class    ON students(class_id);
CREATE INDEX idx_students_status   ON students(status);
-- Search by name is common — index both name parts
CREATE INDEX idx_students_names    ON students(first_name, last_name);


-- ── Parents / Guardians ──────────────────────────────────────
CREATE TYPE relationship_type AS ENUM ('father', 'mother', 'guardian', 'other');

CREATE TABLE parents (
  id               UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID              UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name        VARCHAR(255)      NOT NULL,
  phone            VARCHAR(20)       NOT NULL,   -- Primary contact, used for SMS
  phone_secondary  VARCHAR(20),
  email            VARCHAR(255),
  telegram_chat_id BIGINT,                       -- Set when parent links Telegram bot
  occupation       VARCHAR(100),
  created_at       TIMESTAMP         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_parents_phone      ON parents(phone);
CREATE INDEX idx_parents_telegram   ON parents(telegram_chat_id);


-- ── Student ↔ Parent link ────────────────────────────────────
-- A student can have multiple parents/guardians.
-- A parent can have multiple children in the school.
CREATE TABLE student_parents (
  id             UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id     UUID              NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id      UUID              NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,
  relationship   relationship_type NOT NULL,
  is_primary     BOOLEAN           NOT NULL DEFAULT FALSE, -- Primary contact for SMS
  created_at     TIMESTAMP         NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, parent_id)
);

-- Ensure only one primary contact per student
CREATE UNIQUE INDEX idx_one_primary_parent
  ON student_parents(student_id)
  WHERE is_primary = TRUE;
