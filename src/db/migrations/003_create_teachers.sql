-- ============================================================
-- Migration 003: teachers
-- After users and classes — teachers reference both.
-- We also add the homeroom_teacher_id column to classes here.
-- ============================================================

CREATE TABLE teachers (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  teacher_number  VARCHAR(20)  NOT NULL UNIQUE, -- e.g. "TCH-001"
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(20),
  gender          VARCHAR(10)  CHECK (gender IN ('male', 'female')),
  specialization  VARCHAR(100),                -- Main subject expertise
  qualification   VARCHAR(100),                -- e.g. "B.Ed Mathematics"
  hire_date       DATE,
  photo_url       TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teachers_user_id ON teachers(user_id);
CREATE INDEX idx_teachers_number  ON teachers(teacher_number);

-- ── Teacher ↔ Subject assignments ────────────────────────────
-- A teacher can teach multiple subjects.
-- A subject can be taught by multiple teachers.
CREATE TABLE teacher_subjects (
  id          UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id  UUID      NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id  UUID      NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, subject_id)
);

-- ── Teacher ↔ Class assignments ──────────────────────────────
-- Which teacher teaches which subject in which class
CREATE TABLE teacher_classes (
  id          UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id  UUID      NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id    UUID      NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
  subject_id  UUID      NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, class_id, subject_id)
);

-- ── Now we can add homeroom teacher to classes ────────────────
ALTER TABLE classes
  ADD COLUMN homeroom_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL;
