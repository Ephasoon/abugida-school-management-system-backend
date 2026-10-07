-- ============================================================
-- Migration 016: principal role
-- A principal sees the whole school (read-only for students,
-- teachers, finance, academic years and timetables) and may view,
-- download and upload documents. See docs/PERMISSIONS.md.
-- ============================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'principal';
