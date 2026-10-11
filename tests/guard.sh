#!/usr/bin/env bash
# Usage: guard.sh <command...>  — runs command with DB_NAME forced to the scratch DB.
export DB_NAME=asms_phase0_test
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
node -e "require('dotenv').config(); const n=process.env.DB_NAME; console.log('[guard] DB_NAME =', n); if(n!=='asms_phase0_test'){console.error('[guard] ABORT: not the scratch DB');process.exit(1)}" || exit 1
exec "$@"
