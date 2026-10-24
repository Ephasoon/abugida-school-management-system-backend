-- ============================================================
-- Migration 026: remove what was kept for the old frontend until M10 (PHASE2_PLAN M10)
--
-- exams.term           every exam has its semester (NOT NULL since 020); new exams have to
--                      give a semester or a date inside the class's year (the trigger takes
--                      the date; the term fallback goes).
-- grades.grade_letter  not filled since 021 (no letters, D18).
-- payments.term, category, amount_due, amount_paid
--                      each migrated or old-page payment pays exactly one charge that holds
--                      the same term (legacy_term), category and amount due (024); amount_paid
--                      always equals amount. Refused (exception) if any payment does not.
-- fee_structures_legacy  the 54 per-term fees moved aside in 024; nothing refers to them.
-- term_type stays (student_charges.legacy_term).
-- Dry run and before/after check: tests/check_026.js (through tests/restore_check.sh).
-- Rollback: restore the backup taken before this migration (the dropped values are only there).
-- ============================================================

DO $$
DECLARE
  bad_payments INTEGER;
  bad_amounts  INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_payments FROM payments p
  WHERE (p.term IS NOT NULL OR p.category IS NOT NULL OR p.amount_due IS NOT NULL)
    AND NOT ((SELECT COUNT(*) FROM payment_allocations a WHERE a.payment_id = p.id) = 1
         AND EXISTS (SELECT 1 FROM payment_allocations a JOIN student_charges c ON c.id = a.charge_id
                     WHERE a.payment_id = p.id
                       AND c.legacy_term IS NOT DISTINCT FROM p.term
                       AND c.category::text IS NOT DISTINCT FROM p.category::text
                       AND c.amount_due IS NOT DISTINCT FROM p.amount_due));
  SELECT COUNT(*) INTO bad_amounts FROM payments WHERE amount_paid IS DISTINCT FROM amount;
  IF bad_payments > 0 OR bad_amounts > 0 THEN
    RAISE EXCEPTION 'Migration 026 aborted: % payment(s) whose term/category/amount_due are not on their charge, % with amount_paid <> amount.',
      bad_payments, bad_amounts;
  END IF;
END $$;

-- Exams: the semester from the date only
CREATE OR REPLACE FUNCTION exams_set_semester() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.semester IS NULL AND NEW.exam_date IS NOT NULL THEN
    SELECT CASE WHEN NEW.exam_date >= y.semester2_start THEN 'semester2' ELSE 'semester1' END::semester_type
      INTO NEW.semester
    FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
    WHERE c.id = NEW.class_id AND NEW.exam_date BETWEEN y.start_date AND y.end_date;
  END IF;
  RETURN NEW;   -- still no semester: the NOT NULL constraint refuses the row
END $$;
DROP FUNCTION asms_semester_for(UUID, DATE, term_type);
ALTER TABLE exams DROP COLUMN term;

ALTER TABLE grades DROP COLUMN grade_letter;

ALTER TABLE payments
  DROP COLUMN term,
  DROP COLUMN category,
  DROP COLUMN amount_due,
  DROP COLUMN amount_paid;

DROP TABLE fee_structures_legacy;
