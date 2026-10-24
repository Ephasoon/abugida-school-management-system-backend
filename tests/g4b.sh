#!/usr/bin/env bash
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
source <(sed -n '/^B=/,/^code()/p' $S/g2.sh)
F="$WS/g3.json"
g(){ node -p "require('$F').$1"; }
tok(){ js "$(req POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}")" "r.data.accessToken"; }
AT=$(tok admin@asms.et Admin@1234); TA=$(tok $(g tA.email) Pass#2026); TB=$(tok $(g tB.email) Pass#2026)
TID=$(g tB.tid); C9B=$(g c9B); ENG=$(g eng)
exam(){ code "$(req POST /exam-schedule "$1" "{\"class_id\":\"$C9B\",\"subject_id\":\"$ENG\",\"name\":\"Eng quiz\",\"exam_type\":\"quiz\",\"exam_date\":\"2024-11-15\",\"max_score\":1}")"; }
echo "== Assign, list, remove"
ok $(exam "$TB") 403 "teacher B creates 9B English exam before assignment"
ok $(code "$(req POST /teachers/$TID/classes "$AT" "{\"class_id\":\"$C9B\",\"subject_id\":\"$ENG\"}")") 200 "admin assigns B -> 9B English"
echo "  GET /teachers/:id classes: $(js "$(req GET /teachers/$TID "$AT")" "JSON.stringify(r.data.classes.map(c=>({class:c.name,subject:c.subject_name,class_id:c.id.slice(0,8),subject_id:(c.subject_id||'MISSING').slice(0,8)})))")"
ok $(exam "$TB") 201 "teacher B creates 9B English exam after assignment"
ok $(code "$(req DELETE /teachers/$TID/classes/$C9B/$ENG "$TB")") 403 "teacher cannot remove assignments"
ok $(code "$(req DELETE /teachers/$TID/classes/$C9B/$ENG "$AT")") 200 "admin removes assignment"
ok $(code "$(req DELETE /teachers/$TID/classes/$C9B/$ENG "$AT")") 404 "removing again -> 404"
ok $(code "$(req DELETE /teachers/$TID/classes/not-a-uuid/$ENG "$AT")") 404 "malformed id -> 404"
echo "  classes after removal: $(js "$(req GET /teachers/$TID "$AT")" "r.data.classes.length")"
ok $(exam "$TB") 403 "teacher B blocked again after removal"
echo "  teacher A still assigned: $(js "$(req GET /teachers/$(g tA.tid) "$AT")" "r.data.classes.map(c=>c.name+' / '+c.subject_name).join(', ')")"
