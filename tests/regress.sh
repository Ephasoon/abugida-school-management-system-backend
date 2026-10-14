#!/usr/bin/env bash
# Full regression: every suite on a fresh scratch-DB server (:3100); browser suites use static :5599.
# Usage: regress.sh [suite...]   (no arguments = all suites). Exits 1 if any suite fails.
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
cd $S || exit 1
[ $# -eq 0 ] && set -- g1 g2 g2b g3 g4 g4b g5 g5b g6 g7 g8 g9 g10 g11 g12 g13
busy=$(netstat -ano | grep -oE ":(3100|5599|9333) .*LISTEN.*" | sort -u)
if [ -n "$busy" ]; then echo "test port(s) already in use, abort:"; echo "$busy"; exit 1; fi
export CORS_ORIGINS="http://localhost:5599,http://127.0.0.1:5599"
$S/guard.sh node $S/mkstudents.js | tail -1 > $S/students.json
node static.js > static.log 2>&1 &
sleep 1

run_suite() {
  local t=$1
  case $t in
    g7|g8|g9|g10|g11|g12|g13) $S/guard.sh node "$WS/$t.js" > $t.out 2>&1; grep -E "^PASS=|^TOTAL" $t.out | tr '\n' ' ' ;;
    g5|g5b|g6)   timeout 300 node $t.js > $t.out 2>&1; grep -E "PASS=|ALL PASS|FAILURES" $t.out | tr '\n' ' ' ;;
    *)           $S/$t.sh > $t.out 2>&1; echo -n "PASS=$(grep -c ' PASS ' $t.out) FAIL=$(grep -c ' FAIL ' $t.out)" ;;
  esac
}

failed=()
for t in "$@"; do
  $S/srv.sh start > /dev/null
  r=$(run_suite $t)
  echo "$t: $r"
  # A suite fails on any FAIL count, a FAILURES line, or no summary at all (crash)
  if [ -z "${r// /}" ] || echo "$r" | grep -qE "FAIL=[1-9]|FAILURES"; then failed+=("$t"); fi
  $S/srv.sh stop
done

powershell -NoProfile -Command "Stop-Process -Id $(cat $S/static.winpid) -ErrorAction SilentlyContinue"
sleep 1
netstat -ano | grep -E ":(3100|5599|9333) .*LISTEN" || echo "test ports closed"

if [ ${#failed[@]} -gt 0 ]; then
  for t in "${failed[@]}"; do echo; echo "----- $t.out (last 15 lines)"; tail -15 "$S/$t.out"; done
  echo; echo "FAILED: ${failed[*]} (full output in tests/<suite>.out)"; exit 1
fi
echo "ALL SUITES PASSED ($#)"
