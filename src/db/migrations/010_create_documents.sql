-- ============================================================
-- Migration 010: documents
-- The documents module (document.controller.js) has always needed
-- this table, but no migration created it. Existing installs created
-- it by hand; IF NOT EXISTS keeps those untouched, and the definition
-- below matches that hand-made table so fresh installs get the same.
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID         REFERENCES students(id) ON DELETE CASCADE,
  teacher_id     UUID         REFERENCES teachers(id) ON DELETE CASCADE,
  category       VARCHAR      NOT NULL,      -- validated in the controller
  title          VARCHAR      NOT NULL,
  description    TEXT,
  file_name      VARCHAR      NOT NULL,      -- original upload name (may be Amharic)
  file_path      VARCHAR      NOT NULL,      -- path on disk under uploads/documents
  file_size      INTEGER      DEFAULT 0,
  mime_type      VARCHAR,
  is_private     BOOLEAN      DEFAULT TRUE,  -- private: admins + uploader only
  download_count INTEGER      DEFAULT 0,
  uploaded_by    UUID         REFERENCES users(id),
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_student     ON documents(student_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_category    ON documents(category);
