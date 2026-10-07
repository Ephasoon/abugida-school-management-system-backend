-- ============================================================
-- Migration 015: a grade's score may not exceed its exam's max_score
-- A plain CHECK constraint cannot read another table, so the rule is
-- enforced by triggers:
--   grades: insert/update rejects score > exams.max_score
--           (added to the existing set_grade_letter trigger function)
--   exams:  lowering max_score below an existing grade is rejected
-- Plus a real CHECK on exams: max_score must be positive.
-- The migration stops (and rolls back) if existing data already
-- breaks these rules, reporting how many rows to fix first.
-- ============================================================

DO $$
DECLARE
  bad_grades INTEGER;
  bad_exams  INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_grades
  FROM grades g JOIN exams e ON e.id = g.exam_id
  WHERE g.score > e.max_score;

  SELECT COUNT(*) INTO bad_exams FROM exams WHERE max_score <= 0;

  IF bad_grades > 0 OR bad_exams > 0 THEN
    RAISE EXCEPTION
      'Migration 015 aborted: % grade(s) exceed their exam max_score and % exam(s) have max_score <= 0. Fix these rows, then re-run.',
      bad_grades, bad_exams;
  END IF;
END $$;

ALTER TABLE exams
  ADD CONSTRAINT exams_max_score_positive CHECK (max_score > 0);

-- Grades: same trigger function as migration 006, plus the score limit
CREATE OR REPLACE FUNCTION set_grade_letter() RETURNS TRIGGER AS $$
DECLARE
  v_max_score NUMERIC;
BEGIN
  SELECT max_score INTO v_max_score FROM exams WHERE id = NEW.exam_id;
  IF NEW.score > v_max_score THEN
    RAISE EXCEPTION 'score % exceeds max_score % for exam %', NEW.score, v_max_score, NEW.exam_id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.grade_letter := calculate_grade_letter(NEW.score, v_max_score);
  NEW.updated_at   := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Exams: max_score may not drop below a score already entered
CREATE OR REPLACE FUNCTION check_exam_max_score() RETURNS TRIGGER AS $$
DECLARE
  v_top NUMERIC;
BEGIN
  SELECT MAX(score) INTO v_top FROM grades WHERE exam_id = NEW.id;
  IF v_top IS NOT NULL AND NEW.max_score < v_top THEN
    RAISE EXCEPTION 'max_score % is below an existing score % for exam %', NEW.max_score, v_top, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_exam_max_score
  BEFORE UPDATE OF max_score ON exams
  FOR EACH ROW EXECUTE FUNCTION check_exam_max_score();
