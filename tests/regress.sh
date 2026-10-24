#!/usr/bin/env bash
# Full regression: every suite on a fresh scratch-DB server (:3100); browser suites use static :5599.
# w1/w2 test the new React app in WEB_DIR (default ../asms-web): w1 = type check, lint, unit tests;
# w2 = Playwright in Edge against the built app on :5600 -> :3100. Skipped if WEB_DIR is missing.
# Usage: regress.sh [suite...]   (no arguments = all suites). Exits 1 if any suite fails.
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
cd $S || exit 1
[ $# -eq 0 ] && set -- g1 g2 g2b g3 g4 g4b g5 g5b g6 g7 g8 g9 g10 g11 g12 g13 g14 g15 g16 g17 g18 g19 g20 g21 g22 g23 g24 g25 g26 g27 g28 g29 g30 g31 g32 g33 g34 g35 g36 g37 w1 w2
WEB_DIR="${WEB_DIR:-$S/../../asms-web}"
busy=$(netstat -ano | grep -oE ":(3100|5599|5600|9333) .*LISTEN.*" | sort -u)
if [ -n "$busy" ]; then echo "test port(s) already in use, abort:"; echo "$busy"; exit 1; fi
export CORS_ORIGINS="http://localhost:5599,http://127.0.0.1:5599,http://localhost:5600"
$S/guard.sh node $S/mkstudents.js | tail -1 > $S/students.json
$S/guard.sh node $S/examreset.js | tail -1
node static.js > static.log 2>&1 &
sleep 1

run_suite() {
  local t=$1
  case $t in
    g7|g8|g9|g10|g11|g12|g13|g14|g15|g16|g17|g18|g19|g20|g21|g22|g23|g24|g25|g26|g27|g28|g29|g30|g31|g32|g33|g34|g35|g36|g37) $S/guard.sh node "$WS/$t.js" > $t.out 2>&1; grep -E "^PASS=|^TOTAL" $t.out | tr '\n' ' ' ;;
    g5|g5b|g6)   timeout 300 node $t.js > $t.out 2>&1; grep -E "PASS=|ALL PASS|FAILURES" $t.out | tr '\n' ' ' ;;
    w1|w2)       run_web $t ;;
    *)           $S/$t.sh > $t.out 2>&1; echo -n "PASS=$(grep -c ' PASS ' $t.out) FAIL=$(grep -c ' FAIL ' $t.out)" ;;
  esac
}

# asms-web suites: "PASS=n FAIL=n" from the Vitest / Playwright summary; a non-zero exit with no
# failed tests (type or lint error, build error) counts as FAIL=1.
run_web() {
  local t=$1 status
  if [ ! -f "$WEB_DIR/package.json" ]; then
    echo -n "SKIP (asms-web not found at $WEB_DIR; set WEB_DIR)"; skipped+=("$t"); return
  fi
  if [ $t = w1 ]; then
    (cd "$WEB_DIR" && npm test) > $t.out 2>&1; status=$?
  else
    # The test backend (:3100, asms_phase0_test) is already running; DB_NAME lets the tests use tests/tdb.js
    (cd "$WEB_DIR" && DB_NAME=asms_phase0_test API_TARGET=http://localhost:3100 ASMS_BACKEND_DIR="$(cygpath -m "$S/..")" \
      timeout 900 npx playwright test) > $t.out 2>&1; status=$?
  fi
  # Strip colour codes, then read "Tests  81 passed (81)" (Vitest) or "26 passed (2.0m)" / "2 failed" (Playwright)
  local summary=$(sed 's/\x1b\[[0-9;]*m//g' $t.out | grep -E "^ *(Tests +[0-9]|[0-9]+ (passed|failed))" | tr '\n' ' ')
  local pass=$(echo "$summary" | grep -oE "[0-9]+ passed" | head -1 | grep -oE "[0-9]+")
  local fail=$(echo "$summary" | grep -oE "[0-9]+ failed" | head -1 | grep -oE "[0-9]+")
  [ -z "$fail" ] && fail=0
  [ $status -ne 0 ] && [ "$fail" -eq 0 ] && fail=1
  echo -n "PASS=${pass:-0} FAIL=$fail"
}

failed=(); skipped=()
for t in "$@"; do
  $S/srv.sh start > /dev/null
  run_suite $t > $S/.suite.result; r=$(cat $S/.suite.result)   # not $(...): run_web records skips
  echo "$t: $r"
  # A suite fails on any FAIL count, a FAILURES line, or no summary at all (crash)
  if [ -z "${r// /}" ] || echo "$r" | grep -qE "FAIL=[1-9]|FAILURES"; then failed+=("$t"); fi
  $S/srv.sh stop
done

powershell -NoProfile -Command "Stop-Process -Id $(cat $S/static.winpid) -ErrorAction SilentlyContinue"
sleep 1
netstat -ano | grep -E ":(3100|5599|5600|9333) .*LISTEN" || echo "test ports closed"

if [ ${#failed[@]} -gt 0 ]; then
  for t in "${failed[@]}"; do echo; echo "----- $t.out (last 15 lines)"; tail -15 "$S/$t.out"; done
  echo; echo "FAILED: ${failed[*]} (full output in tests/<suite>.out)"; exit 1
fi
if [ ${#skipped[@]} -gt 0 ]; then echo "ALL SUITES PASSED ($(( $# - ${#skipped[@]} )) run, skipped: ${skipped[*]})"; exit 0; fi
echo "ALL SUITES PASSED ($#)"
