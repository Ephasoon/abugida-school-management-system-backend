#!/usr/bin/env bash
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
source <(sed -n '/^B=/,/^code()/p' $S/g2.sh)
st(){ node -p "require('$WS/students.json')['$1'].$2"; }
R=$(req POST /auth/login "" '{"email":"admin@asms.et","password":"Admin@1234"}' admin); AT=$(js "$R" "r.data.accessToken")
login(){ req POST /auth/login "" "{\"email\":\"$1\",\"password\":\"Stud#2026\"}" "$2"; }

echo "== Student: archive (DELETE /students/:id)"
E=$(st archive email); SID=$(st archive studentId)
R=$(login $E sa); ok $(code "$R") 200 "student login"; T=$(js "$R" "r.data.accessToken")
ok $(code "$(req GET /students/$SID/summary "$T")") 200 "student reads own summary"
ok $(code "$(req DELETE /students/$SID "$AT")") 200 "admin archives student"
ok $(code "$(req GET /students/$SID/summary "$T")") 401 "student token rejected at once"
ok $(code "$(req POST /auth/refresh "" "" sa)") 401 "student refresh revoked"
ok $(code "$(login $E)") 403 "student login refused"

echo "== Student: status change (PUT status=suspended, then active)"
E=$(st suspend email); SID=$(st suspend studentId)
R=$(login $E ss); T=$(js "$R" "r.data.accessToken")
ok $(code "$(req PUT /students/$SID "$AT" '{"status":"suspended"}')") 200 "admin suspends"
ok $(code "$(req GET /students/$SID/summary "$T")") 401 "suspended student's token rejected"
ok $(code "$(login $E)") 403 "suspended student login refused"
ok $(code "$(req PUT /students/$SID "$AT" '{"status":"active"}')") 200 "admin reactivates"
ok $(code "$(login $E)") 200 "student can log in again"
ok $(code "$(req PUT /students/$SID "$AT" '{"phone":"0911"}')") 200 "edit without status"
ok $(code "$(login $E)") 200 "  ...leaves login enabled"

echo "== Student: graduation via promotion"
E=$(st graduate email); SID=$(st graduate studentId)
R=$(login $E sg); T=$(js "$R" "r.data.accessToken")
# Safe promotion (M7a) on its own years: the student is moved to a grade 12 class there and graduated
ok "$(node "$WS/graduate.js" "$AT" "$SID")" 200 "promote grade 12 (preview + apply)"
ok $(code "$(req GET /students/$SID/summary "$T")") 401 "student token rejected at once"
ok $(code "$(req POST /auth/refresh "" "" sg)") 401 "student refresh revoked"
ok $(code "$(login $E)") 403 "student login refused"

echo "== Refresh tokens issued before this change (no jti) are rejected"
OLD=$(node -e "require('$WS/../node_modules/dotenv').config({path:'$WS/../.env'});const j=require('$WS/../node_modules/jsonwebtoken');const p=JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64url'));console.log(j.sign({id:p.id},process.env.JWT_REFRESH_SECRET,{expiresIn:'7d'}))" $AT)
ok "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/auth/refresh -b "refreshToken=$OLD")" 401 "legacy refresh token"

echo "== CORS"
hdr(){ curl -s -D - -o /dev/null -H "Origin: $1" http://localhost:3100/health | tr -d '\r' | tr 'A-Z' 'a-z' | grep '^access-control-allow-origin' || echo "(no ACAO header)"; }
ok "$(hdr null)" "(no ACAO header)" "Origin null refused"
ok "$(hdr http://localhost:5600)" "access-control-allow-origin: http://localhost:5600" "Origin in CORS_ORIGINS allowed"
ok "$(hdr http://localhost:5500)" "(no ACAO header)" "old frontend origin (5500) no longer allowed"
ok "$(hdr http://evil.example)" "(no ACAO header)" "other origin refused"

echo "== Login rate limit (5 failures / 15 min per IP+email)"
for i in 1 2 3 4 5; do printf "  bad attempt $i -> %s\n" $(code "$(req POST /auth/login "" '{"email":"admin@asms.et","password":"wrong"}')"); done
ok $(code "$(req POST /auth/login "" '{"email":"admin@asms.et","password":"Admin@1234"}')") 429 "6th attempt blocked even with correct password"
echo "  body: $(cat $J/body)"
ok $(code "$(req POST /auth/login "" '{"email":"ADMIN@asms.et ","password":"wrong"}')") 429 "case/space variant of same email also blocked"
ok $(code "$(req POST /auth/login "" '{"email":"other@asms.et","password":"wrong"}')") 401 "different email from same IP not blocked"
