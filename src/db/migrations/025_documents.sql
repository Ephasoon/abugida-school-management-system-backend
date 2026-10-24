-- ============================================================
-- Migration 025: documents (M9)
-- is_private was nullable (NULL was treated as private): now NOT NULL, default private.
-- The category list is checked by the database (12 categories; M9 adds transfer_letter,
-- report_card and national_exam). Nothing else changes; every row is kept.
-- ============================================================

DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM documents WHERE category NOT IN (
    'id_document','birth_certificate','transcript','medical','photo','letter','certificate','report','other',
    'transfer_letter','report_card','national_exam');
  IF bad > 0 THEN RAISE EXCEPTION 'Migration 025: % document(s) with an unknown category', bad; END IF;
END $$;

UPDATE documents SET is_private = TRUE WHERE is_private IS NULL;
ALTER TABLE documents ALTER COLUMN is_private SET DEFAULT TRUE;
ALTER TABLE documents ALTER COLUMN is_private SET NOT NULL;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check CHECK (category IN (
  'id_document','birth_certificate','transcript','medical','photo','letter','certificate','report','other',
  'transfer_letter','report_card','national_exam'));

CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
