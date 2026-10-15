#!/usr/bin/env bash
# Rehearse on a fresh copy of asms (never asms itself):
#   1. tests/restore_check.sh <label> <check>: pg_dump asms (read-only) -> restore into
#      asms_restore_check -> migrate it -> before/after check
#   2. on the COPY only: admin@asms.et gets the test password Rehearsal#2026 (no forced change)
#   3. starts the backend on :3100 against asms_restore_check (Ctrl+C stops it)
# Usage: bash tests/rehearsal.sh            (label 019, check tests/check_019.js)
#        bash tests/rehearsal.sh --no-refresh   (keep the copy as it is, just start the server)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
TARGET=asms_restore_check
if [ "${1:-}" != "--no-refresh" ]; then
  bash tests/restore_check.sh "${LABEL:-019}" "${CHECK:-tests/check_019.js}"
fi
export DB_NAME=$TARGET
node -e "
if (process.env.DB_NAME !== 'asms_restore_check') { console.error('ABORT: not the copy'); process.exit(1); }
require('dotenv').config();
const { Client } = require('pg'); const bcrypt = require('bcryptjs');
(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'asms_restore_check' });
  await c.connect();
  if ((await c.query('select current_database() d')).rows[0].d !== 'asms_restore_check') process.exit(1);
  await c.query(\"UPDATE users SET password_hash = \$1, must_change_password = FALSE WHERE email = 'admin@asms.et'\", [await bcrypt.hash('Rehearsal#2026', 12)]);
  console.log('[rehearsal] copy ready: admin@asms.et / Rehearsal#2026 (asms_restore_check only)');
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });"
echo "[rehearsal] backend on http://localhost:3100 against $TARGET (Ctrl+C to stop)"
PORT=3100 exec node -e "if (process.env.DB_NAME !== 'asms_restore_check') process.exit(1); require('./src/server.js')"
