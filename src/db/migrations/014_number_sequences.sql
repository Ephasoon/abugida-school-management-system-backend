-- ============================================================
-- Migration 014: sequences for student and teacher numbers
-- Replaces COUNT(*)+1, which produced duplicates when two records were
-- created at the same time. Each sequence starts after the highest
-- number already issued in the standard format, so no number repeats.
--   students: ASMS-YYYY-NNN  (NNN from student_number_seq)
--   teachers: TCH-NNN        (NNN from teacher_number_seq)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS student_number_seq;
CREATE SEQUENCE IF NOT EXISTS teacher_number_seq;

-- setval(seq, n, true): the next nextval() returns n + 1.
-- With no existing numbers: setval(seq, 1, false) so the first value is 1.
SELECT CASE WHEN m IS NULL THEN setval('student_number_seq', 1, false)
            ELSE setval('student_number_seq', m, true) END
FROM (SELECT MAX(substring(student_number FROM '^ASMS-[0-9]{4}-([0-9]+)$')::BIGINT) AS m
      FROM students) s;

SELECT CASE WHEN m IS NULL THEN setval('teacher_number_seq', 1, false)
            ELSE setval('teacher_number_seq', m, true) END
FROM (SELECT MAX(substring(teacher_number FROM '^TCH-([0-9]+)$')::BIGINT) AS m
      FROM teachers) t;
