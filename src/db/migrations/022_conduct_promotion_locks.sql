-- ============================================================
-- Migration 022: conduct, manual promotion decisions, semester locks (B2, PHASE2_PLAN §5.2)
--
-- semester_conduct: conduct grade A–D and a homeroom remark per student, year and semester
--   (D23), entered by the homeroom teacher of the class or the admin.
-- promotion_decisions: the admin's Promoted / Not promoted for a student and year (D26):
--   required for grades in manual_promotion_grades, an override for others. Audited by the API.
-- semester_locks: a locked semester (whole school when class_id is NULL, or one class) refuses
--   every change to its results (scores, exams, conduct, promotion decisions, attendance in its
--   dates) with 409 until it is unlocked (D29). Lock and unlock are audited by the API.
-- Nothing in existing rows changes.
-- Rollback: DROP TABLE semester_locks, promotion_decisions, semester_conduct; DROP TYPE conduct_grade.
-- ============================================================

CREATE TYPE conduct_grade AS ENUM ('A', 'B', 'C', 'D');

CREATE TABLE semester_conduct (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID          NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id UUID          NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  semester         semester_type NOT NULL,
  class_id         UUID          NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  conduct          conduct_grade NOT NULL,
  remark           VARCHAR(300),
  entered_by       UUID          REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, academic_year_id, semester)
);
CREATE INDEX idx_semester_conduct_class ON semester_conduct(class_id, semester);

CREATE TABLE promotion_decisions (
  id               UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID      NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id UUID      NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  promoted         BOOLEAN   NOT NULL,
  note             VARCHAR(300),
  decided_by       UUID      REFERENCES users(id) ON DELETE SET NULL,
  decided_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, academic_year_id)
);

CREATE TABLE semester_locks (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id UUID          NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  semester         semester_type NOT NULL,
  class_id         UUID          REFERENCES classes(id) ON DELETE CASCADE,   -- NULL = the whole school
  reason           VARCHAR(300),
  locked_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  locked_at        TIMESTAMP     NOT NULL DEFAULT NOW()
);
-- One lock per year, semester and class; one whole-school lock per year and semester
CREATE UNIQUE INDEX semester_locks_class_uq  ON semester_locks(academic_year_id, semester, class_id) WHERE class_id IS NOT NULL;
CREATE UNIQUE INDEX semester_locks_school_uq ON semester_locks(academic_year_id, semester) WHERE class_id IS NULL;
