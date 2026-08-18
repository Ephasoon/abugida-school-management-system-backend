-- ============================================================
-- Migration 006: exams + grades
-- Exams are defined first (what test, what subject, what class).
-- Grades are the results — one per student per exam.
-- ============================================================

CREATE TYPE exam_type AS ENUM ('quiz', 'midterm', 'final', 'assignment', 'project');
CREATE TYPE term_type AS ENUM ('term1', 'term2', 'term3');

-- ── Exams ────────────────────────────────────────────────────
-- Defines an exam event: "Grade 10A Math Midterm, Term 1, max 100 pts"
CREATE TABLE exams (
  id               UUID       PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id         UUID       NOT NULL REFERENCES classes(id)   ON DELETE RESTRICT,
  subject_id       UUID       NOT NULL REFERENCES subjects(id)  ON DELETE RESTRICT,
  academic_year_id UUID       NOT NULL REFERENCES academic_years(id),
  name             VARCHAR(100) NOT NULL,          -- "Midterm Exam"
  exam_type        exam_type  NOT NULL,
  term             term_type  NOT NULL,
  max_score        NUMERIC(5,2) NOT NULL DEFAULT 100,
  exam_date        DATE,
  created_by       UUID       REFERENCES teachers(id) ON DELETE SET NULL,
  created_at       TIMESTAMP  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exams_class   ON exams(class_id);
CREATE INDEX idx_exams_subject ON exams(subject_id);
CREATE INDEX idx_exams_term    ON exams(term);


-- ── Grades ───────────────────────────────────────────────────
-- One row per student per exam — their actual score.
CREATE TABLE grades (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id   UUID         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_id      UUID         NOT NULL REFERENCES exams(id)    ON DELETE RESTRICT,
  score        NUMERIC(5,2) NOT NULL CHECK (score >= 0),
  grade_letter VARCHAR(3),  -- Calculated: A+, A, B+, B, C+, C, D, F
  remarks      TEXT,
  entered_by   UUID         REFERENCES teachers(id) ON DELETE SET NULL,
  entered_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),

  -- One grade per student per exam
  UNIQUE (student_id, exam_id),

  -- Score cannot exceed the exam's max_score (enforced in app logic too)
  CONSTRAINT valid_score CHECK (score >= 0)
);

CREATE INDEX idx_grades_student ON grades(student_id);
CREATE INDEX idx_grades_exam    ON grades(exam_id);


-- ── Grade Letter Function ────────────────────────────────────
-- Automatically calculates grade letter from percentage score.
-- Ethiopian grading scale (MoE standard).
CREATE OR REPLACE FUNCTION calculate_grade_letter(
  p_score     NUMERIC,
  p_max_score NUMERIC
) RETURNS VARCHAR(3) AS $$
DECLARE
  percentage NUMERIC;
BEGIN
  IF p_max_score = 0 THEN RETURN 'N/A'; END IF;
  percentage := (p_score / p_max_score) * 100;

  RETURN CASE
    WHEN percentage >= 90 THEN 'A+'
    WHEN percentage >= 85 THEN 'A'
    WHEN percentage >= 80 THEN 'A-'
    WHEN percentage >= 75 THEN 'B+'
    WHEN percentage >= 70 THEN 'B'
    WHEN percentage >= 65 THEN 'B-'
    WHEN percentage >= 60 THEN 'C+'
    WHEN percentage >= 55 THEN 'C'
    WHEN percentage >= 50 THEN 'C-'
    WHEN percentage >= 45 THEN 'D'
    ELSE 'F'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ── Auto-calculate grade letter on INSERT or UPDATE ──────────
CREATE OR REPLACE FUNCTION set_grade_letter() RETURNS TRIGGER AS $$
DECLARE
  v_max_score NUMERIC;
BEGIN
  SELECT max_score INTO v_max_score FROM exams WHERE id = NEW.exam_id;
  NEW.grade_letter := calculate_grade_letter(NEW.score, v_max_score);
  NEW.updated_at   := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_grade_letter
  BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION set_grade_letter();
