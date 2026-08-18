-- ============================================================
-- Migration 002: academic_years + classes
-- Must come before students and teachers because both
-- reference classes, and classes reference academic_years.
-- ============================================================

-- ── Academic Years ───────────────────────────────────────────
-- Tracks each school year (e.g. 2024/2025).
-- Only ONE year should be is_current = TRUE at a time.
CREATE TABLE academic_years (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(9)   NOT NULL UNIQUE, -- e.g. "2024/2025"
  start_date DATE         NOT NULL,
  end_date   DATE         NOT NULL,
  is_current BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Seed current academic year
INSERT INTO academic_years (name, start_date, end_date, is_current)
VALUES ('2024/2025', '2024-09-01', '2025-07-31', TRUE);


-- ── Classes ──────────────────────────────────────────────────
-- A class is one grade+section combo in one academic year.
-- Example: "Grade 10 — Section A" in 2024/2025
-- homeroom_teacher_id is added later (migration 003) via ALTER TABLE
-- because teachers table doesn't exist yet.
CREATE TABLE classes (
  id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  academic_year_id     UUID         NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  name                 VARCHAR(100) NOT NULL,        -- "Grade 10 Section A"
  grade_level          SMALLINT     NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
  section              CHAR(1)      NOT NULL CHECK (section IN ('A','B','C','D','E')),
  capacity             SMALLINT     NOT NULL DEFAULT 45,
  created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),

  -- One grade+section per academic year only
  UNIQUE (academic_year_id, grade_level, section)
);

CREATE INDEX idx_classes_year  ON classes(academic_year_id);
CREATE INDEX idx_classes_grade ON classes(grade_level);

-- Seed classes for 2024/2025
-- We'll reference the academic year we just inserted
INSERT INTO classes (academic_year_id, name, grade_level, section, capacity)
SELECT
  id,
  'Grade ' || grade || ' Section ' || section,
  grade,
  section,
  45
FROM
  (SELECT id FROM academic_years WHERE name = '2024/2025') ay,
  (VALUES (7),(8),(9),(10),(11),(12)) AS grades(grade),
  (VALUES ('A'),('B')) AS sections(section);


-- ── Subjects ─────────────────────────────────────────────────
CREATE TABLE subjects (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  name_am     VARCHAR(100),               -- Amharic name
  code        VARCHAR(10)  NOT NULL UNIQUE, -- e.g. "MATH10"
  grade_level SMALLINT     CHECK (grade_level BETWEEN 1 AND 12),
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

INSERT INTO subjects (name, name_am, code, grade_level) VALUES
  ('Mathematics',       'ሒሳብ',              'MATH',  NULL),
  ('English',           'እንግሊዝኛ',           'ENG',   NULL),
  ('Amharic',           'አማርኛ',             'AMH',   NULL),
  ('Biology',           'ባዮሎጂ',             'BIO',   NULL),
  ('Chemistry',         'ኬሚስትሪ',            'CHEM',  NULL),
  ('Physics',           'ፊዚክስ',             'PHY',   NULL),
  ('History',           'ታሪክ',              'HIST',  NULL),
  ('Civics',            'ሲቪክስ',             'CIV',   NULL),
  ('Geography',         'ጂኦግራፊ',           'GEO',   NULL),
  ('Physical Education','አካላዊ ትምህርት',       'PE',    NULL),
  ('ICT',               'መረጃ ቴክኖሎጂ',       'ICT',   NULL);
