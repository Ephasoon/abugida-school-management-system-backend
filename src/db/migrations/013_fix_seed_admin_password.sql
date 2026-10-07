-- ============================================================
-- Migration 013: fix the seed admin password
-- Migration 001 documented the admin password as 'Admin@1234', but its
-- hash did not match that password, so a fresh install had no usable
-- admin login. This resets the hash ONLY if it is still the broken
-- seed hash; an admin whose password was already changed is untouched.
-- A reset account must change its password at first login.
-- The new hash below is bcrypt (12 rounds) of 'Admin@1234'.
-- ============================================================

UPDATE users
SET password_hash        = '$2a$12$SBEZcWwBsayTC2/okj8nKey0Pxigrm.J0ocXbfhHN9LSDjCXEX9Z2',
    must_change_password = TRUE,
    updated_at           = NOW()
WHERE email = 'admin@asms.et'
  AND password_hash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBpj2v.5MWGV3.';
