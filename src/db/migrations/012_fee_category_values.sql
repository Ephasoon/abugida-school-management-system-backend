-- ============================================================
-- Migration 012: extra fee categories
-- Adds library, sport, uniform and transport to fee_category.
-- Existing values (tuition, registration, material, exam, other)
-- are unchanged. term_type is intentionally NOT extended ('annual'
-- was dropped from the controller instead).
-- ============================================================

ALTER TYPE fee_category ADD VALUE IF NOT EXISTS 'library';
ALTER TYPE fee_category ADD VALUE IF NOT EXISTS 'sport';
ALTER TYPE fee_category ADD VALUE IF NOT EXISTS 'uniform';
ALTER TYPE fee_category ADD VALUE IF NOT EXISTS 'transport';
