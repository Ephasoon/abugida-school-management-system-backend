-- ============================================================
-- Migration 007: finance (fee structures + payments)
-- Fee structures define what students owe.
-- Payments record what they've actually paid.
-- ============================================================

CREATE TYPE fee_category   AS ENUM ('tuition', 'registration', 'material', 'exam', 'other');
CREATE TYPE payment_method AS ENUM ('cash', 'bank_transfer', 'cbe_birr', 'telebirr', 'other');
CREATE TYPE payment_status AS ENUM ('paid', 'partial', 'unpaid', 'waived');


-- ── Fee Structures ───────────────────────────────────────────
-- Defines how much each grade level owes per term per category.
CREATE TABLE fee_structures (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  academic_year_id UUID         NOT NULL REFERENCES academic_years(id),
  grade_level      SMALLINT     CHECK (grade_level BETWEEN 1 AND 12),
                                -- NULL means applies to ALL grades
  term             term_type    NOT NULL,
  category         fee_category NOT NULL,
  amount           NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  description      TEXT,
  due_date         DATE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),

  UNIQUE (academic_year_id, grade_level, term, category)
);

-- Seed standard fee structure for 2024/2025
-- You can adjust amounts as needed
INSERT INTO fee_structures (academic_year_id, grade_level, term, category, amount, description)
SELECT
  ay.id,
  g.grade,
  t.term::term_type,
  c.category::fee_category,
  c.amount,
  c.description
FROM
  (SELECT id FROM academic_years WHERE name = '2024/2025') ay,
  (VALUES (7),(8),(9),(10)) AS g(grade),
  (VALUES ('term1'),('term2'),('term3')) AS t(term),
  (VALUES
    ('tuition',      3500, 'Term tuition fee'),
    ('material',      500, 'Books and stationery'),
    ('exam',          200, 'Examination fee')
  ) AS c(category, amount, description);

-- Different amount for grades 11-12
INSERT INTO fee_structures (academic_year_id, grade_level, term, category, amount, description)
SELECT
  ay.id,
  g.grade,
  t.term::term_type,
  c.category::fee_category,
  c.amount,
  c.description
FROM
  (SELECT id FROM academic_years WHERE name = '2024/2025') ay,
  (VALUES (11),(12)) AS g(grade),
  (VALUES ('term1'),('term2'),('term3')) AS t(term),
  (VALUES
    ('tuition',      4500, 'Term tuition fee'),
    ('material',      650, 'Books and stationery'),
    ('exam',          250, 'Examination fee')
  ) AS c(category, amount, description);


-- ── Payments ─────────────────────────────────────────────────
-- Each row = one payment transaction by a student.
CREATE TABLE payments (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id       UUID           NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  fee_structure_id UUID           REFERENCES fee_structures(id)    ON DELETE SET NULL,
  academic_year_id UUID           NOT NULL REFERENCES academic_years(id),
  term             term_type      NOT NULL,
  category         fee_category   NOT NULL,
  amount_due       NUMERIC(10,2)  NOT NULL,
  amount_paid      NUMERIC(10,2)  NOT NULL CHECK (amount_paid >= 0),
  payment_method   payment_method NOT NULL DEFAULT 'cash',
  payment_date     DATE           NOT NULL DEFAULT CURRENT_DATE,
  receipt_number   VARCHAR(50)    UNIQUE,
  reference        VARCHAR(100),  -- Bank ref, Telebirr txn ID, etc.
  recorded_by      UUID           REFERENCES users(id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_student ON payments(student_id);
CREATE INDEX idx_payments_date    ON payments(payment_date);
CREATE INDEX idx_payments_term    ON payments(term);


-- ── Convenience view: student fee summary ────────────────────
-- This VIEW makes it easy to check a student's total balance.
-- Query it like: SELECT * FROM student_fee_summary WHERE student_id = '...';
CREATE VIEW student_fee_summary AS
SELECT
  s.id              AS student_id,
  s.student_number,
  s.first_name || ' ' || s.last_name AS full_name,
  p.academic_year_id,
  p.term,
  SUM(p.amount_due)  AS total_due,
  SUM(p.amount_paid) AS total_paid,
  SUM(p.amount_due) - SUM(p.amount_paid) AS balance,
  CASE
    WHEN SUM(p.amount_due) <= SUM(p.amount_paid)  THEN 'paid'
    WHEN SUM(p.amount_paid) = 0                    THEN 'unpaid'
    ELSE 'partial'
  END AS status
FROM students s
LEFT JOIN payments p ON p.student_id = s.id
GROUP BY s.id, s.student_number, s.first_name, s.last_name,
         p.academic_year_id, p.term;
