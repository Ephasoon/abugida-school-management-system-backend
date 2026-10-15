-- ============================================================
-- Migration 021: results out of 100, no letters or GPA (B2, PHASE2_PLAN §5.2)
--
-- grades: the trigger no longer fills grade_letter. set_grade_letter() becomes
--   check_grade_score(), keeping the max-score check of 015 (and updated_at);
--   calculate_grade_letter() is dropped. grades.grade_letter stays (read-only, no
--   longer filled) for one release, then is dropped. Existing letters are kept.
-- school_settings: key -> JSONB value, audited by the API (PUT /settings/:key).
--   pass_yearly_average = 50 (D17), manual_promotion_grades = [] (D26).
-- Nothing in existing rows changes.
-- Rollback: re-create set_grade_letter() and calculate_grade_letter() from 015/006
--   and point trg_set_grade_letter at it again; DROP TABLE school_settings.
-- ============================================================

CREATE OR REPLACE FUNCTION check_grade_score() RETURNS TRIGGER AS $$
DECLARE
  v_max_score NUMERIC;
BEGIN
  SELECT max_score INTO v_max_score FROM exams WHERE id = NEW.exam_id;
  IF NEW.score > v_max_score THEN
    RAISE EXCEPTION 'score % exceeds max_score % for exam %', NEW.score, v_max_score, NEW.exam_id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER trg_set_grade_letter ON grades;
CREATE TRIGGER trg_check_grade_score
  BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION check_grade_score();
DROP FUNCTION set_grade_letter();
DROP FUNCTION calculate_grade_letter(NUMERIC, NUMERIC);

COMMENT ON COLUMN grades.grade_letter IS 'Read-only since 021 (no longer filled); dropped in a later release.';

CREATE TABLE school_settings (
  key         VARCHAR(60) PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);
INSERT INTO school_settings (key, value) VALUES
  ('pass_yearly_average', '50'),
  ('manual_promotion_grades', '[]');
