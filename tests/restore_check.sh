#!/usr/bin/env bash
# Real-data check (PHASE2_PLAN D24, §5): rehearse pending migrations on a copy of asms.
#   1. pg_dump of asms (read-only for asms) -> C:\asms\asms_backup_before_<label>_<time>.dump
#   2. restore it into asms_restore_check (emptied first; the database must exist,
#      owned by the app user: createdb -U postgres -O asms_user asms_restore_check)
#   3. node <check> before; node src/db/migrate.js; node <check> after
# Everything that writes goes to asms_restore_check only; this script refuses any other target.
# Usage: bash tests/restore_check.sh <label> <check-script>   e.g.  018 tests/check_018.js
set -euo pipefail
TARGET=asms_restore_check
LABEL=${1:?label, e.g. 018}; CHECK=${2:?check script}
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/18/bin}"
eval "$(node -e "require('dotenv').config(); for (const k of ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD']) console.log(k + '=' + JSON.stringify(process.env[k] || ''))")"
export PGHOST=$DB_HOST PGPORT=$DB_PORT PGUSER=$DB_USER PGPASSWORD=$DB_PASSWORD

[ "$TARGET" = asms_restore_check ] || { echo "ABORT: target must be asms_restore_check"; exit 1; }
if ! "$PGBIN/psql" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET'" | grep -q 1; then
  echo "ABORT: database $TARGET does not exist. Create it once as a superuser:"
  echo "  createdb -U postgres -O $DB_USER $TARGET"; exit 1
fi

DUMP="$(cd .. && pwd -W)/asms_backup_before_${LABEL}_$(date +%Y%m%d_%H%M%S).dump"
echo "[1] pg_dump asms -> $DUMP (read-only)"
"$PGBIN/pg_dump" -Fc -d asms -f "$DUMP"
echo "    $(du -k "$DUMP" | cut -f1) KB"

echo "[2] restore into $TARGET (emptied first)"
"$PGBIN/psql" -q -d $TARGET -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
"$PGBIN/pg_restore" --no-owner --no-privileges -d $TARGET "$DUMP"
"$PGBIN/psql" -d $TARGET -tAc "SELECT current_database() || ': ' || (SELECT COUNT(*) FROM _migrations) || ' migrations applied, last ' || (SELECT MAX(filename) FROM _migrations)"

export DB_NAME=$TARGET
echo "[3] check before"
node "$CHECK" before
echo "[4] migrate $TARGET"
node -e "if (process.env.DB_NAME !== 'asms_restore_check') { console.error('ABORT'); process.exit(1) }"
node src/db/migrate.js | grep -vE "SKIP|^$"
echo "[5] check after"
node "$CHECK" after
