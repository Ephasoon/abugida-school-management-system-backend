#!/usr/bin/env bash
S="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; WS="$(cygpath -m "$S")"   # this tests/ folder (bash path, Windows path)
B=http://localhost:3100/api; J=$S/jar; rm -rf $J; mkdir -p $J
# req METHOD PATH [TOKEN] [JSON] [JARNAME]  -> prints "STATUS body"
req(){ local a=(-s -o $J/body -w '%{http_code}' -X "$1" "$B$2" -H 'Content-Type: application/json');
  [ -n "$3" ] && a+=(-H "Authorization: Bearer $3"); [ -n "$4" ] && a+=(-d "$4");
  [ -n "$5" ] && a+=(-b "$J/$5" -c "$J/$5"); local st; st=$(curl "${a[@]}"); echo "$st $(cat $J/body)"; }
js(){ node -e "const r=JSON.parse(process.argv[1].replace(/^\d+ /,''));console.log($2)" "$1"; }
ok(){ if [ "$1" = "$2" ]; then echo "  PASS  $3 ($1)"; else echo "  FAIL  $3: expected $2, got $1"; fi; }
code(){ echo "${1%% *}"; }

echo "== Admin login, 15-minute access token"
R=$(req POST /auth/login "" '{"email":"admin@asms.et","password":"Admin@1234"}' admin); ok $(code "$R") 200 "admin login"
AT=$(js "$R" "r.data.accessToken")
echo "  access token lifetime: $(node -e "const p=JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64url'));console.log(p.exp-p.iat,'seconds')" $AT)"
echo "  refresh cookie: $(grep -o 'refreshToken.*' $J/admin | cut -c1-30)... HttpOnly=$(grep -c '#HttpOnly' $J/admin)"

echo "== Refresh, then logout revokes that refresh token"
ok $(code "$(req POST /auth/refresh "" "" admin)") 200 "refresh with valid cookie"
cp $J/admin $J/admin_before_logout
ok $(code "$(req POST /auth/logout "" "" admin)") 200 "logout"
ok $(code "$(req POST /auth/refresh "" "" admin_before_logout)") 401 "old refresh token after logout"
R=$(req POST /auth/login "" '{"email":"admin@asms.et","password":"Admin@1234"}' admin); AT=$(js "$R" "r.data.accessToken")

echo "== Teacher creation: random temp password, returned once, flag set"
EM="t$RANDOM@asms.et"
R=$(req POST /teachers "$AT" "{\"first_name\":\"Almaz\",\"last_name\":\"Tesfaye\",\"email\":\"$EM\"}"); ok $(code "$R") 201 "create teacher"
TP=$(js "$R" "r.data.temporary_password"); TID=$(js "$R" "r.data.id")
echo "  temporary_password field: ${#TP} chars; message: $(js "$R" "r.message")"
echo "  message contains password: $(js "$R" "r.message.includes(r.data.temporary_password)")  login_password present: $(js "$R" "'login_password' in r.data")"
ok $(code "$(req POST /auth/login "" "{\"email\":\"$EM\",\"password\":\"Teacher@1234\"}")") 401 "old default password rejected"

echo "== must_change_password gate"
R=$(req POST /auth/login "" "{\"email\":\"$EM\",\"password\":\"$TP\"}" teacher); ok $(code "$R") 200 "teacher login with temp password"
echo "  login says must_change_password: $(js "$R" "r.data.user.must_change_password")"
TT=$(js "$R" "r.data.accessToken"); cp $J/teacher $J/teacher_pre_change
R=$(req GET /students "$TT"); ok $(code "$R") 403 "GET /students blocked"; echo "  body: ${R#* }"
ok $(code "$(req GET /auth/me "$TT")") 403 "GET /auth/me blocked"
ok $(code "$(req POST /auth/change-password "$TT" "{\"currentPassword\":\"$TP\",\"newPassword\":\"$TP\"}")") 400 "reusing temp password rejected"
R=$(req POST /auth/change-password "$TT" "{\"currentPassword\":\"$TP\",\"newPassword\":\"NewPass#2026\"}" teacher); ok $(code "$R") 200 "change-password allowed"
ok $(code "$(req GET /students "$TT")") 200 "same access token works after change (gate lifted)"
ok $(code "$(req POST /auth/refresh "" "" teacher_pre_change)") 401 "pre-change refresh token revoked"
ok $(code "$(req POST /auth/refresh "" "" teacher)") 200 "new session from change-password works"
TT=$(js "$R" "r.data.accessToken")

echo "== Deactivating a teacher takes effect immediately"
ok $(code "$(req PUT /teachers/$TID "$AT" '{"is_active":false}')") 200 "admin deactivates teacher"
ok $(code "$(req GET /students "$TT")") 401 "teacher access token rejected at once"
ok $(code "$(req POST /auth/refresh "" "" teacher)") 401 "teacher refresh token revoked"
ok $(code "$(req POST /auth/login "" "{\"email\":\"$EM\",\"password\":\"NewPass#2026\"}")") 403 "teacher login refused"
ok $(code "$(req PUT /teachers/$TID "$AT" '{"is_active":true}')") 200 "admin reactivates teacher"
ok $(code "$(req POST /auth/login "" "{\"email\":\"$EM\",\"password\":\"NewPass#2026\"}")") 200 "teacher can log in again"
ok $(code "$(req PUT /teachers/$TID "$AT" '{"phone":"0911000000"}')") 200 "unrelated teacher edit"
ok $(code "$(req POST /auth/login "" "{\"email\":\"$EM\",\"password\":\"NewPass#2026\"}")") 200 "  ...does not disable login"
