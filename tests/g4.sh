#!/usr/bin/env bash
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
source <(sed -n '/^B=/,/^code()/p' $S/g2.sh)
F="$WS/g3.json"
g(){ node -p "require('$F').$1"; }
tok(){ js "$(req POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}")" "r.data.accessToken"; }
q(){ $S/guard.sh node -e "require('$WS/tdb.js').query(process.argv[1],process.argv.slice(2)).then(r=>{console.log(JSON.stringify(r.rows));process.exit(0)}).catch(e=>{console.log('ERR',e.message);process.exit(0)})" "$@" | grep -v guard; }
AT=$(tok admin@asms.et Admin@1234); TA=$(tok $(g tA.email) Pass#2026)
C9A=$(g c9A); MATH=$(g math); S1=$(g s1.sid)
echo "  server TZ check: $(node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)")"

echo "== Exam schedules persist (migration 011), atomically"
# Re-runnable: cancel a "Final G4" left by an earlier run (one final per class/subject/term).
# Only its date is listed: the whole list can grow past the command-line limit of js().
for old in $(js "$(req GET "/exam-schedule?class_id=$C9A&from_date=2025-03-20&to_date=2025-03-20" "$AT")" "r.data.filter(e=>e.name==='Final G4').map(e=>e.id).join(' ')"); do
  echo "  cancel leftover Final G4: $(code "$(req DELETE /exam-schedule/$old "$AT")")"
done
R=$(req POST /exam-schedule "$AT" "{\"class_id\":\"$C9A\",\"subject_id\":\"$MATH\",\"name\":\"Final G4\",\"exam_type\":\"final\",\"term\":\"term2\",\"exam_date\":\"2025-03-20\",\"start_time\":\"08:30\",\"end_time\":\"10:30\",\"room\":\"Lab 2\",\"instructions\":\"Bring a calculator\"}")
ok $(code "$R") 201 "schedule exam with time/room"; EID=$(js "$R" "r.data.id")
echo "  exam_schedules row: $(q "SELECT start_time,end_time,room,instructions FROM exam_schedules WHERE exam_id=\$1" $EID)"
ok $(code "$(req POST /exam-schedule "$AT" "{\"class_id\":\"$C9A\",\"subject_id\":\"$MATH\",\"name\":\"Bad time\",\"exam_type\":\"quiz\",\"term\":\"term2\",\"exam_date\":\"2025-03-21\",\"start_time\":\"10:00\",\"end_time\":\"09:00\"}")") 400 "end_time before start_time"
LONG=$(printf 'R%.0s' $(seq 1 60))
R=$(req POST /exam-schedule "$AT" "{\"class_id\":\"$C9A\",\"subject_id\":\"$MATH\",\"name\":\"Atomic check\",\"exam_type\":\"quiz\",\"term\":\"term2\",\"exam_date\":\"2025-03-22\",\"start_time\":\"08:00\",\"end_time\":\"09:00\",\"room\":\"$LONG\"}")
ok $(code "$R") 500 "schedule insert fails (room > 50 chars) -> error surfaces"
echo "  exam row left behind: $(q "SELECT count(*) FROM exams WHERE name='Atomic check'")"

echo "== Finance categories/terms"
pay(){ code "$(req POST /finance/payments "$AT" "{\"student_id\":\"$S1\",\"amount_due\":100,\"amount_paid\":50,\"payment_method\":\"cash\",\"payment_date\":\"2026-10-07\"$1}")"; }
for c in transport library sport uniform material registration; do ok $(pay ",\"category\":\"$c\"") 201 "category $c"; done
ok $(pay ',"category":"books"') 400 "unknown category rejected"
ok $(pay ',"term":"annual"') 400 "term annual rejected"
ok $(pay ',"term":"term3"') 201 "term term3"
echo "  omitted category/term stored as: $(q "SELECT category,term FROM payments WHERE student_id=\$1 ORDER BY created_at DESC LIMIT 1" $S1)"

echo "== Student/teacher numbers from sequences (10 parallel creates each)"
for i in $(seq 1 10); do curl -s -o $J/st$i -X POST $B/students -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"first_name\":\"Par\",\"last_name\":\"$i\",\"gender\":\"male\"}" & done; wait
for i in $(seq 1 10); do curl -s -o $J/tc$i -X POST $B/teachers -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"first_name\":\"Par\",\"last_name\":\"$i\",\"email\":\"par$i.$RANDOM@asms.et\"}" & done; wait
node -e "const fs=require('fs');const d=process.argv[1];for(const p of ['st','tc']){const r=[...Array(10)].map((_,i)=>JSON.parse(fs.readFileSync(d+'/'+p+(i+1))));const ok=r.filter(x=>x.success);const nums=ok.map(x=>x.data.student_number||x.data.teacher_number);console.log('  '+p+': success',ok.length+'/10','unique',new Set(nums).size,' e.g.',nums.sort().slice(0,3).join(', '))}" "$(cygpath -m $J)"

echo "== Score limits"
R=$(req POST /grades/exams "$AT" "{\"class_id\":\"$C9A\",\"subject_id\":\"$MATH\",\"name\":\"Max10\",\"exam_type\":\"quiz\",\"term\":\"term1\",\"max_score\":10}"); XID=$(js "$R" "r.data.id")
for sc in 11 -1 '"abc"'; do ok $(code "$(req POST /grades "$TA" "{\"exam_id\":\"$XID\",\"grades\":[{\"student_id\":\"$S1\",\"score\":$sc}]}")") 400 "score $sc on max 10"; done
R=$(req POST /grades "$TA" "{\"exam_id\":\"$XID\",\"grades\":[{\"student_id\":\"$S1\",\"score\":9},{\"student_id\":\"$S1\",\"score\":12}]}"); ok $(code "$R") 400 "batch with one bad score"; echo "  body: ${R#* }"
echo "  nothing saved from rejected batch: $(q "SELECT count(*) FROM grades WHERE exam_id=\$1" $XID)"
ok $(code "$(req POST /grades "$TA" "{\"exam_id\":\"$XID\",\"grades\":[{\"student_id\":\"$S1\",\"score\":10}]}")") 200 "score 10 on max 10"
ok $(code "$(req PUT /exam-schedule/$XID "$AT" '{"max_score":5}')") 400 "lower max_score below entered score"; echo "  body: $(cat $J/body)"
ok $(code "$(req PUT /exam-schedule/$XID "$AT" '{"max_score":0}')") 400 "max_score 0"
ok $(code "$(req POST /grades/exams "$AT" "{\"class_id\":\"$C9A\",\"subject_id\":\"$MATH\",\"name\":\"X\",\"exam_type\":\"quiz\",\"term\":\"term1\",\"max_score\":1000}")") 400 "create exam max_score 1000"
ok $(code "$(req PUT /exam-schedule/$XID "$AT" '{"max_score":20}')") 200 "raise max_score"

echo "== GET /students includes class_id"
echo "  $(js "$(req GET "/students?limit=200" "$AT")" "(s=>JSON.stringify({id:s.id.slice(0,8),class_id:s.class_id,class_name:s.class_name}))(r.data.students.find(s=>s.id==='$S1'))")"

echo "== Non-ASCII (Amharic) download filename"
cp $S/sample.pdf "$S/የተማሪ ሰነድ.pdf"
DID=$(js "$(cd $S && curl -s -H "Authorization: Bearer $AT" -F "file=@የተማሪ ሰነድ.pdf;type=application/pdf" -F title=amharic -F category=report $B/documents/upload)" "r.data.id")
curl -s -D $J/h -o $J/dl -H "Authorization: Bearer $AT" $B/documents/download/$DID -w "  download status %{http_code}\n"
tr -d '\r' < $J/h | grep -iE "^content-(disposition|type)" | sed 's/^/  /'
echo "  bytes identical: $(cmp -s $J/dl $S/sample.pdf && echo yes || echo no)"
echo "  decoded filename*: $(node -e "const h=require('fs').readFileSync(process.argv[1],'utf8');console.log(decodeURIComponent(h.match(/filename\*=UTF-8''([^;\r\n]+)/i)[1]))" "$(cygpath -m $J/h)")"

echo "== DATE columns as YYYY-MM-DD (server TZ Africa/Addis_Ababa)"
q "UPDATE students SET date_of_birth='2010-05-03', enrollment_date='2026-09-01' WHERE id=\$1 RETURNING id" $S1 >/dev/null
echo "  student: $(js "$(req GET /students/$S1 "$AT")" "JSON.stringify({dob:r.data.date_of_birth,enrolled:r.data.enrollment_date})")"
echo "  exam:    $(js "$(req GET "/exam-schedule?class_id=$C9A&from_date=2025-03-20&to_date=2025-03-20" "$AT")" "JSON.stringify(r.data.filter(e=>e.name==='Final G4').map(e=>e.exam_date))")"
echo "  calendar keys Nov 2026: $(js "$(req GET "/exam-schedule/calendar?month=11&year=2026" "$AT")" "Object.keys(r.data.by_date).join(',')")"
echo "  attendance: $(js "$(req GET /attendance/student/7fc8ff6c-f082-4f54-a015-df0bb49ae61a "$AT")" "r.data.records.map(x=>x.date).join(',')")  (stored as 2026-10-01, 2026-10-02)"
