-- ============================================================
-- Migration 024: monthly fees (M8, PHASE2_PLAN §5.3 B3; D19-D22, D27)
--
-- Charges (what a student owes) and payments (receipts) are kept apart:
--   fee_structures       monthly or one-time fee per academic year, grade (NULL = all) and category;
--                        months charged (default Meskerem-Sene, 1-10) and due day (default 10)
--   student_charges      one row per student x fee x Ethiopian month (NULL month = one-time,
--                        manual or legacy); discount snapshot; waiver
--   student_discounts    percent or fixed amount per student and fee, with a reason (D22)
--   payments             a receipt: amount, method, reference; reversal instead of deletion
--   payment_allocations  which charges a payment covers
--   receipt_counters     RCP-<E.C. year>-00001, sequential per Ethiopian year, no gaps
--
-- Existing data (D20, decided 2026-10-24):
--   - The 54 per-term fee_structures rows (unused: no payment refers to them) move to
--     fee_structures_legacy, unchanged.
--   - Each existing payment row becomes a legacy charge (no month, legacy_term = its term,
--     same year, category and amount_due) plus the same payment (receipt number, date, method,
--     amount = amount_paid) and an allocation between them. Nothing is spread over months.
--   - The migration fails (and changes nothing) if any total per student and year differs.
-- payments.term, category and amount_due stay (nullable) until M10 for the old frontend.
-- Rollback: restore the backup taken before 024.
-- ============================================================

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'mpesa' AFTER 'telebirr';
CREATE TYPE fee_frequency AS ENUM ('monthly', 'one_time');
CREATE TYPE discount_kind AS ENUM ('percent', 'amount');
CREATE TYPE discount_reason AS ENUM ('sibling', 'staff_child', 'scholarship', 'other');

-- ── Before: totals per student and year ─────────────────────
CREATE TEMP TABLE _m8_before ON COMMIT DROP AS
  SELECT student_id, academic_year_id, COUNT(*) AS n, SUM(amount_due) AS due, SUM(amount_paid) AS paid
  FROM payments GROUP BY student_id, academic_year_id;

-- ── Old per-term fee structures ─────────────────────────────
CREATE TABLE fee_structures_legacy (LIKE fee_structures INCLUDING DEFAULTS);
ALTER TABLE fee_structures_legacy ADD PRIMARY KEY (id);
INSERT INTO fee_structures_legacy SELECT * FROM fee_structures;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM payments WHERE fee_structure_id IS NOT NULL) THEN
    RAISE EXCEPTION '024: % payment(s) refer to a fee structure; expected none',
      (SELECT COUNT(*) FROM payments WHERE fee_structure_id IS NOT NULL);
  END IF;
END $$;
DELETE FROM fee_structures;

ALTER TABLE fee_structures
  DROP CONSTRAINT fee_structures_academic_year_id_grade_level_term_category_key,
  DROP COLUMN term,
  ALTER COLUMN amount TYPE NUMERIC(12,2),
  ADD COLUMN frequency  fee_frequency NOT NULL DEFAULT 'monthly',
  ADD COLUMN months     SMALLINT[]    NOT NULL DEFAULT '{1,2,3,4,5,6,7,8,9,10}',
  ADD COLUMN due_day    SMALLINT      CHECK (due_day BETWEEN 1 AND 30),
  ADD COLUMN created_by UUID          REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at TIMESTAMP     NOT NULL DEFAULT NOW(),
  ADD CONSTRAINT fee_structures_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT fee_structures_months_valid CHECK (
    (frequency = 'monthly'  AND cardinality(months) BETWEEN 1 AND 13 AND months <@ '{1,2,3,4,5,6,7,8,9,10,11,12,13}' AND due_day IS NOT NULL AND due_date IS NULL)
    OR (frequency = 'one_time' AND cardinality(months) = 0 AND due_day IS NULL));
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_year_grade_category_key
  UNIQUE NULLS NOT DISTINCT (academic_year_id, grade_level, category);

-- ── Charges ─────────────────────────────────────────────────
CREATE TABLE student_discounts (
  id               UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id       UUID            NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  fee_structure_id UUID            NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  kind             discount_kind   NOT NULL,
  value            NUMERIC(12,2)   NOT NULL CHECK (value > 0),
  reason           discount_reason NOT NULL,
  note             TEXT,
  from_month       SMALLINT        CHECK (from_month BETWEEN 1 AND 13),
  to_month         SMALLINT        CHECK (to_month BETWEEN 1 AND 13),
  created_by       UUID            REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP       NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, fee_structure_id),
  CHECK (kind = 'amount' OR value <= 100),
  CHECK (reason <> 'other' OR COALESCE(btrim(note), '') <> ''),
  CHECK (from_month IS NULL OR to_month IS NULL OR from_month <= to_month)
);

CREATE TABLE student_charges (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id       UUID           NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_year_id UUID           NOT NULL REFERENCES academic_years(id),
  fee_structure_id UUID           REFERENCES fee_structures(id) ON DELETE RESTRICT,  -- NULL: manual or legacy
  category         fee_category   NOT NULL,
  eth_month        SMALLINT       CHECK (eth_month BETWEEN 1 AND 13),                -- NULL: one-time
  amount_due       NUMERIC(12,2)  NOT NULL CHECK (amount_due >= 0),                  -- before discount
  discount_amount  NUMERIC(12,2)  NOT NULL DEFAULT 0,
  discount_id      UUID           REFERENCES student_discounts(id) ON DELETE SET NULL,
  due_date         DATE,
  description      TEXT,
  legacy_term      term_type,                                                        -- migrated term payment
  waived_at        TIMESTAMP,
  waived_by        UUID           REFERENCES users(id) ON DELETE SET NULL,
  waive_reason     TEXT,
  created_by       UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMP      NOT NULL DEFAULT NOW(),
  CHECK (discount_amount >= 0 AND discount_amount <= amount_due),
  CHECK ((waived_at IS NULL) = (waive_reason IS NULL))
);
CREATE UNIQUE INDEX student_charges_one_per_month ON student_charges (student_id, fee_structure_id, eth_month)
  NULLS NOT DISTINCT WHERE fee_structure_id IS NOT NULL;
CREATE INDEX idx_charges_student ON student_charges(student_id, academic_year_id);
CREATE INDEX idx_charges_year_month ON student_charges(academic_year_id, eth_month);

-- ── Payments become receipts ────────────────────────────────
ALTER TABLE payments
  ALTER COLUMN term DROP NOT NULL,
  ALTER COLUMN category DROP NOT NULL,
  ALTER COLUMN amount_due DROP NOT NULL,
  ADD COLUMN amount          NUMERIC(12,2),
  ADD COLUMN reversed_at     TIMESTAMP,
  ADD COLUMN reversed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reversal_reason TEXT;
UPDATE payments SET amount = amount_paid;
ALTER TABLE payments
  ALTER COLUMN amount SET NOT NULL,
  ADD CONSTRAINT payments_amount_nonneg CHECK (amount >= 0),
  ADD CONSTRAINT payments_reversal CHECK ((reversed_at IS NULL) = (reversal_reason IS NULL));

CREATE TABLE payment_allocations (
  id         UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID          NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  charge_id  UUID          NOT NULL REFERENCES student_charges(id) ON DELETE RESTRICT,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  UNIQUE (payment_id, charge_id)
);
CREATE INDEX idx_allocations_charge ON payment_allocations(charge_id);

CREATE TABLE receipt_counters (
  eth_year    SMALLINT PRIMARY KEY,
  last_number INTEGER  NOT NULL CHECK (last_number >= 0)
);

-- ── Existing payments -> legacy charge + payment + allocation ─
ALTER TABLE student_charges ADD COLUMN _legacy_payment UUID;
INSERT INTO student_charges (student_id, academic_year_id, category, amount_due, legacy_term, created_by, created_at, _legacy_payment)
  SELECT student_id, academic_year_id, category, amount_due, term, recorded_by, created_at, id FROM payments;
INSERT INTO payment_allocations (payment_id, charge_id, amount)
  SELECT c._legacy_payment, c.id, p.amount_paid FROM student_charges c JOIN payments p ON p.id = c._legacy_payment
  WHERE p.amount_paid > 0;
ALTER TABLE student_charges DROP COLUMN _legacy_payment;

-- ── Balance per charge ──────────────────────────────────────
-- due = amount_due - discount (a waived charge is due only what was paid on it);
-- paid = allocations of payments that are not reversed.
DROP VIEW student_fee_summary;
CREATE VIEW student_charge_balances AS
SELECT c.*, x.paid,
  CASE WHEN c.waived_at IS NOT NULL THEN x.paid ELSE c.amount_due - c.discount_amount END AS net_due,
  CASE WHEN c.waived_at IS NOT NULL THEN 0::numeric(12,2) ELSE c.amount_due - c.discount_amount - x.paid END AS balance,
  CASE WHEN c.waived_at IS NOT NULL THEN 'waived'
       WHEN c.amount_due - c.discount_amount - x.paid <= 0 THEN 'paid'
       WHEN x.paid > 0 THEN 'partial'
       ELSE 'unpaid' END AS status
FROM student_charges c
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(a.amount), 0)::NUMERIC(12,2) AS paid
  FROM payment_allocations a JOIN payments p ON p.id = a.payment_id AND p.reversed_at IS NULL
  WHERE a.charge_id = c.id
) x;

-- ── After = before, or nothing changes ──────────────────────
DO $$
DECLARE bad INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad FROM (
    SELECT COALESCE(b.student_id, a.student_id) s
    FROM _m8_before b
    FULL JOIN (
      SELECT student_id, academic_year_id, COUNT(*) AS n, SUM(net_due) AS due, SUM(paid) AS paid
      FROM student_charge_balances GROUP BY student_id, academic_year_id
    ) a ON a.student_id = b.student_id AND a.academic_year_id = b.academic_year_id
    WHERE a.n IS DISTINCT FROM b.n OR a.due IS DISTINCT FROM b.due OR a.paid IS DISTINCT FROM b.paid
  ) d;
  IF bad > 0 THEN RAISE EXCEPTION '024: totals differ for % student/year pair(s); nothing changed', bad; END IF;
  IF (SELECT COALESCE(SUM(amount), 0) FROM payments) <> (SELECT COALESCE(SUM(paid), 0) FROM _m8_before) THEN
    RAISE EXCEPTION '024: payment amounts differ from amount_paid';
  END IF;
END $$;
