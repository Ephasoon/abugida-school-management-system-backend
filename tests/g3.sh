#!/usr/bin/env bash
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
source <(sed -n '/^B=/,/^code()/p' $S/g2.sh)
F="$WS/g3.json"
g(){ node -p "require('$F').$1"; }
tok(){ js "$(req POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}")" "r.data.accessToken"; }
AT=$(tok admin@asms.et Admin@1234); TA=$(tok $(g tA.email) Pass#2026); TB=$(tok $(g tB.email) Pass#2026)
TS=$(tok $(g s1.email) Pass#2026); TP=$(tok $(g parent.email) Pass#2026)
S1=$(g s1.sid); S2=$(g s2.sid); S3=$(g s3.sid)

echo "== Student/parent record access"
for who in "student:$TS" "parent:$TP"; do n=${who%%:*}; T=${who#*:}
  for ep in "/students/%s/summary" "/attendance/student/%s" "/grades/report-card/%s" "/pdf/report-card/%s"; do
    ok $(code "$(req GET $(printf $ep $S1) "$T")") 200 "$n -> own/linked $(printf $ep S1)"
    ok $(code "$(req GET $(printf $ep $S2) "$T")") 403 "$n -> other   $(printf $ep S2)"
  done
  ok $(code "$(req GET /students/not-a-uuid/summary "$T")") 403 "$n -> malformed id"
done
ok $(code "$(req GET /students/$S2/summary "$TA")") 200 "teacher -> any student summary (staff)"
ok $(code "$(req GET /students/$S2 "$TS")") 403 "student -> GET /students/:id still staff-only"

echo "== Finance is admin-only"
for ep in /finance/summary /finance/payments /finance/unpaid /finance/student/$S1; do
  ok $(code "$(req GET $ep "$TA")") 403 "teacher GET $ep"; done
ok $(code "$(req POST /finance/payments "$TA" '{}')") 403 "teacher POST /finance/payments"
ok $(code "$(req GET /finance/summary "$AT")") 200 "admin GET /finance/summary"

echo "== Private documents: admin + uploader"
up(){ js "$(cd $S && curl -s -H "Authorization: Bearer $1" -F "file=@sample.pdf;type=application/pdf" -F "title=$2" -F category=report -F is_private=$3 -F student_id=$S1 http://localhost:3100/api/documents/upload)" "r.data.id"; }
printf '%%PDF-1.4\n%%test\n' > $S/sample.pdf
DA_PRIV=$(up "$TA" "A private" true); DA_PUB=$(up "$TA" "A public" false); DB_PRIV=$(up "$TB" "B private" true)
titles(){ js "$(req GET "$1" "$2")" "(r.data.documents||r.data).map(d=>d.title).sort().join(' | ')"; }
echo "  teacher A list:        $(titles /documents "$TA")"
echo "  teacher B list:        $(titles /documents "$TB")"
echo "  admin list:            $(titles /documents "$AT")"
echo "  teacher A student docs: $(titles /documents/student/$S1 "$TA")"
echo "  teacher A categories (report count): $(js "$(req GET /documents/categories "$TA")" "r.data.find(c=>c.key==='report').count")   admin: $(js "$(req GET /documents/categories "$AT")" "r.data.find(c=>c.key==='report').count")"
ok $(code "$(req GET /documents/$DB_PRIV "$TA")") 404 "teacher A GET B's private doc"
ok "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TA" localhost:3100/api/documents/download/$DB_PRIV)" 404 "teacher A download B's private doc"
ok "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TA" localhost:3100/api/documents/download/$DA_PRIV)" 200 "teacher A download own private doc"
ok "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TB" localhost:3100/api/documents/download/$DA_PUB)" 200 "teacher B download A's public doc"
ok "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $AT" localhost:3100/api/documents/download/$DB_PRIV)" 200 "admin download B's private doc"

echo "== Grade writes limited to assigned class+subject"
EX=$(g c9A); MATH=$(g math); ENG=$(g eng)
R=$(req POST /grades/exams "$TA" "{\"class_id\":\"$EX\",\"subject_id\":\"$MATH\",\"name\":\"Quiz A\",\"exam_type\":\"quiz\",\"term\":\"term1\",\"max_score\":10}"); ok $(code "$R") 201 "teacher A creates exam 9A Math"; EXAM=$(js "$R" "r.data.id")
ok $(code "$(req POST /grades/exams "$TA" "{\"class_id\":\"$EX\",\"subject_id\":\"$ENG\",\"name\":\"Q\",\"exam_type\":\"quiz\",\"term\":\"term1\"}")") 403 "teacher A creates exam 9A English"
ok $(code "$(req POST /grades/exams "$TB" "{\"class_id\":\"$EX\",\"subject_id\":\"$MATH\",\"name\":\"Q\",\"exam_type\":\"quiz\",\"term\":\"term1\"}")") 403 "teacher B creates exam 9A Math"
ok $(code "$(req POST /grades "$TA" "{\"exam_id\":\"$EXAM\",\"grades\":[{\"student_id\":\"$S1\",\"score\":9},{\"student_id\":\"$S2\",\"score\":7},{\"score\":5}]}")") 200 "teacher A grades own class"
R=$(req POST /grades "$TA" "{\"exam_id\":\"$EXAM\",\"grades\":[{\"student_id\":\"$S1\",\"score\":9.5},{\"student_id\":\"$S3\",\"score\":5}]}"); ok $(code "$R") 403 "teacher A grades a 9B student"; echo "  body: ${R#* }"
ok $(code "$(req POST /grades "$TB" "{\"exam_id\":\"$EXAM\",\"grades\":[{\"student_id\":\"$S1\",\"score\":1}]}")") 403 "teacher B grades A's exam"
ok $(code "$(req POST /grades "$AT" "{\"exam_id\":\"$EXAM\",\"grades\":[{\"student_id\":\"$S3\",\"score\":6}]}")") 200 "admin grades any student"
echo "  S1 score still 9 after rejected writes: $(js "$(req GET /grades/report-card/$S1 "$AT")" "r.data.subjects[0].exams.map(e=>e.score).join(',')")"

echo "== 500s: generic message + error id, full error logged"
ok $(code "$(req GET /students/not-a-uuid "$AT")") 404 "admin GET /students/not-a-uuid (malformed id: 404, not 500)"
# No route fails on purpose any more, so send a real pg error through sendServerError (tests/err500.js)
R=$($S/guard.sh node "$WS/err500.js" 2>$S/err500.log | tail -1); ok $(code "$R") 500 "database error -> 500"; echo "  body: ${R#* }"
ID=$(js "$R" "r.errors.error_id"); ok "$(js "$R" "r.message")" "Server error while fetching student. (ref: $ID)" "generic message with ref"
echo "  log: $(tr -d '\r' < $S/err500.log | grep -m1 "error $ID")"
ok "$(tr -d '\r' < $S/err500.log | grep -A2 "error $ID" | grep -c 'invalid input syntax')" 1 "log has pg detail"
