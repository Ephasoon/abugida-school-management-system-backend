-- ============================================================
-- Migration 020: two semesters instead of three terms (B1, PHASE2_PLAN §5.1)
--
-- academic_years.semester2_start: semester 1 = start_date … the day before,
--   semester 2 = semester2_start … end_date. Default (D14): Yekatit 1 of the
--   Ethiopian year the school year falls in, i.e. the Ethiopian year of its
--   end_date (2019 E.C. -> 2027-02-08). Existing years are backfilled with it.
-- exams.semester: an exam with a date inside its class's year gets the semester
--   containing that date; otherwise term1 -> semester 1, term2/term3 -> semester 2.
--   A trigger fills it the same way when an insert leaves it out (old code paths
--   and raw inserts keep working while `term` exists).
-- exams.term: now nullable and read-only for one release, then dropped.
-- The dry run (tests/check_020.js before) lists term/date disagreements, exams
-- dated outside their year and term3 exams.
-- Rollback: DROP TRIGGER trg_exams_semester ON exams; DROP FUNCTION
--   exams_set_semester(), asms_semester_for(); ALTER TABLE exams DROP COLUMN
--   semester (after setting term NOT NULL again only if no row has a NULL term);
--   ALTER TABLE academic_years DROP COLUMN semester2_start; DROP FUNCTION
--   asms_semester2_default(DATE), asms_ethiopian_year(DATE); DROP TYPE semester_type.
-- ============================================================

CREATE TYPE semester_type AS ENUM ('semester1', 'semester2');

-- Ethiopian year of a Gregorian date (same arithmetic as src/utils/ethiopianDate.js:
-- Julian day number, epoch 1723856)
CREATE FUNCTION asms_ethiopian_year(d DATE) RETURNS INTEGER
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 4 * ((j - 1723856) / 1461) + ((j - 1723856) % 1461) / 365 - ((j - 1723856) % 1461) / 1460
  FROM (SELECT to_char(d, 'J')::int AS j) x
$$;

-- Yekatit 1 of the Ethiopian year of a school year's end date (D14)
CREATE FUNCTION asms_semester2_default(end_date DATE) RETURNS DATE
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT to_date((1723856 + 365 + 365 * (y - 1) + y / 4 + 30 * 6 + 1 - 31)::text, 'J')
  FROM (SELECT asms_ethiopian_year(end_date) AS y) x
$$;

ALTER TABLE academic_years ADD COLUMN semester2_start DATE;
-- The default, or the middle of the year if it falls outside (listed by the dry run)
UPDATE academic_years SET semester2_start = CASE
  WHEN asms_semester2_default(end_date) > start_date AND asms_semester2_default(end_date) <= end_date
    THEN asms_semester2_default(end_date)
  ELSE start_date + ((end_date - start_date) / 2) END;
ALTER TABLE academic_years ALTER COLUMN semester2_start SET NOT NULL;
ALTER TABLE academic_years ADD CONSTRAINT academic_years_semester2_in_year
  CHECK (semester2_start > start_date AND semester2_start <= end_date);

-- The semester of an exam: by date when it lies inside the class's year, else by term
CREATE FUNCTION asms_semester_for(p_class_id UUID, p_date DATE, p_term term_type) RETURNS semester_type
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_date IS NOT NULL AND p_date BETWEEN y.start_date AND y.end_date
      THEN CASE WHEN p_date >= y.semester2_start THEN 'semester2' ELSE 'semester1' END::semester_type
    WHEN p_term = 'term1' THEN 'semester1'::semester_type
    WHEN p_term IN ('term2', 'term3') THEN 'semester2'::semester_type
    ELSE NULL END
  FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
  WHERE c.id = p_class_id
$$;

ALTER TABLE exams ADD COLUMN semester semester_type;
UPDATE exams SET semester = asms_semester_for(class_id, exam_date, term);
ALTER TABLE exams ALTER COLUMN semester SET NOT NULL;
ALTER TABLE exams ALTER COLUMN term DROP NOT NULL;
CREATE INDEX idx_exams_semester ON exams(class_id, subject_id, semester);

-- Inserts without a semester (old code paths, fixtures) get it like the backfill
CREATE FUNCTION exams_set_semester() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.semester IS NULL THEN
    NEW.semester := asms_semester_for(NEW.class_id, NEW.exam_date, NEW.term);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_exams_semester BEFORE INSERT ON exams
  FOR EACH ROW EXECUTE FUNCTION exams_set_semester();
