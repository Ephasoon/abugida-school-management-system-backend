#!/usr/bin/env bash
# Phase 0 Group 1: injection and query safety (term parameter, pagination). Server :3100, scratch DB.
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
B=http://localhost:3100/api
for i in $(seq 1 20); do curl -s $B/../health >/dev/null && break; sleep 0.5; done
T=$($S/guard.sh node $S/token.js admin@asms.et 2>/dev/null | tail -c +1 | grep -v guard)
ST=7fc8ff6c-f082-4f54-a015-df0bb49ae61a
# c PATH EXPECTED_STATUS
c(){ local got; got=$(curl -s -o "$S/r.json" -w '%{http_code}' -H "Authorization: Bearer $T" "$B$1")
  if [ "$got" = "$2" ]; then echo "  PASS  $1 ($got)"; else echo "  FAIL  $1: expected $2, got $got  $(head -c 160 "$S/r.json")"; fi; }
echo "== SQL injection (term)"
c "/grades/report-card/$ST?term=term1" 200
c "/grades/report-card/$ST?term=term2" 200
c "/grades/report-card/$ST?term=term1'%20OR%20'1'='1" 400
c "/pdf/report-card/$ST?term=x'%3BDROP%20TABLE%20grades--" 400
R=$(curl -s -H "Authorization: Bearer $T" "$B/pdf/report-card/$ST?term=term1" -o "$S/p.pdf" -w '%{http_code} %{content_type}')
case "$R" in "200 application/pdf"*) echo "  PASS  /pdf/report-card valid term1 -> PDF ($R)";; *) echo "  FAIL  /pdf/report-card valid term1: got $R";; esac
echo "== finance summary (parameterized year)"
c "/finance/summary" 200
echo "== pagination"
c "/students" 200
c "/students?limit=200" 200
c "/students?limit=201" 400
c "/students?limit=abc" 400
c "/students?page=0" 400
c "/students?limit=-5" 400
c "/finance/payments?limit=1&page=1" 200
c "/finance/payments?limit=NaN" 400
c "/attendance/student/$ST?limit=1" 200
c "/attendance/student/$ST?limit=1e9" 400
c "/documents?limit=999" 400
