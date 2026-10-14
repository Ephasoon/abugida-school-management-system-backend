# ASMS Phase 0 — Security & Integrity Report

Branch `phase-0-security` in both repositories. Nothing is deployed, and no migration has been run against the `asms` database. Everything was verified against the scratch database `asms_phase0_test`, which has been kept for reuse.

---

## 1. Commits

### Backend (`C:\asms\asms-backend`)

| Commit | Summary |
|---|---|
| `97286c7` | **Group 1.** Parameterized SQL (`term`, finance year id, attendance LIMIT); pagination validation (default 50, max 200) |
| `e1801f4` | `.gitattributes`: LF line endings (the repo content was already LF) |
| `0b68592` | **Group 2.** 15-minute access tokens, revocable refresh sessions, login rate limit, CORS from env, temporary teacher passwords, `must_change_password` |
| `a39e0ea` | **Group 3.** Record-level access for students and parents, teachers removed from finance, private documents, grade writes limited to assignments, error ids |
| `39fdfe8` | **Group 4.** Migrations 010–015, transactional exam scheduling, finance enums, sequences, score limits, `class_id` on `/students`, RFC 5987 filenames, DATE as `YYYY-MM-DD` |
| `ff7471d` | `DELETE /teachers/:id/classes/:classId/:subjectId`; `subject_id` in `GET /teachers/:id` |
| `75d1010` | CORS exposes `Content-Disposition` so the frontend can read download filenames |

### Frontend (`C:\asms\asms-frontend`)

| Commit | Summary |
|---|---|
| `6a2e294` | `.gitattributes`: LF line endings |
| `032c816` | **Group 5.** `escapeHtml()` on all API data, `config.js` (single API base URL), refresh-on-401 in `api.js`, logout revokes the session |
| `acac926` | One-time teacher password modal; `change-password.html` |
| `364436c` | `teacher-assignments.html` (admin assigns and removes teacher → class + subject) |
| `22d457b` | Follow-ups: parent portal on the shared `api.js`, authenticated blob downloads, finance UI hidden from non-admins, attendance card fixed |

---

## 2. Migrations to run (in this order)

Run them with your usual command (`npm run migrate`) against `asms`. `migrate.js` runs each file in its own transaction and skips files that were already applied.

| # | File | What it does | Notes for your database |
|---|---|---|---|
| 1 | `009_auth_sessions.sql` | `users.must_change_password`, `refresh_tokens` table | — |
| 2 | `010_create_documents.sql` | `documents` table + indexes | `CREATE TABLE IF NOT EXISTS`: your hand-made table is kept as is; only the 3 indexes are added |
| 3 | `011_create_exam_schedules.sql` | `exam_schedules` (time, room, instructions) | New table |
| 4 | `012_fee_category_values.sql` | Adds `library`, `sport`, `uniform`, `transport` to `fee_category` | `term_type` unchanged (no `annual`) |
| 5 | `013_fix_seed_admin_password.sql` | Resets `admin@asms.et` to `Admin@1234` + `must_change_password` | **Only if** its hash is still the broken seed hash. If your admin can log in today, this does nothing. |
| 6 | `014_number_sequences.sql` | `student_number_seq`, `teacher_number_seq` | Starts after the highest existing `ASMS-YYYY-NNN` / `TCH-NNN` (with your data at the time of the audit: next student 007, next teacher 008) |
| 7 | `015_grade_score_limits.sql` | Triggers: score ≤ max_score, max_score can't drop below an entered score; `CHECK (max_score > 0)` | Aborts with a clear message if existing rows violate the rules. Optional pre-check below. |

Optional pre-check for 015 (both counts should be 0):

```sql
SELECT COUNT(*) FROM grades g JOIN exams e ON e.id = g.exam_id WHERE g.score > e.max_score;
SELECT COUNT(*) FROM exams WHERE max_score <= 0;
```

Tested: all 15 migrations were applied to the scratch DB (which has a hand-made-style `documents` table like yours). A full **fresh install** (001→015 in an empty schema) was also simulated, including 015 aborting on bad data and then succeeding once the data was fixed.

---

## 3. Before Phase 0 goes live — checklist

1. **Enter class assignments for every teacher.** `teacher_classes` has 0 rows in your database. Until a teacher is assigned to a class + subject on **Teachers → 🏫 Class Assignments**, they cannot create exams or enter grades (they get 403).
2. **Run migrations 009–015** (section 2).
3. **Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET`** in `.env`. Access tokens already issued under the old `JWT_EXPIRES_IN=100d` keep a valid signature until their 100 days run out, and only a new secret invalidates them. (Old refresh tokens are already rejected because they have no session id.) Everyone will need to log in again either way.
4. **Delete `JWT_EXPIRES_IN` from `.env`.** It is no longer read; access tokens are fixed at 15 minutes in code.
5. **Add `CORS_ORIGINS`** to `.env` with the real frontend origin(s), comma-separated (see `.env.example`). If it is unset, `localhost`/`127.0.0.1` on ports 5500–5501 are allowed. The `null` origin is always rejected, so **opening the HTML files directly from disk (`file://`) no longer works**; serve them over HTTP.
6. **Serve the frontend and the API under the same hostname** (`config.js` does this by default: page hostname, port 3000). The refresh cookie is `SameSite=Strict`, so `127.0.0.1` ↔ `localhost` would break refresh. For production, set `API_BASE` in `assets/js/config.js`.
7. **Existing teachers** keep their current passwords (no forced change). New teachers get a one-time temporary password that is shown once.
8. In production (`NODE_ENV=production`) the refresh cookie is `Secure`, so HTTPS is required.

---

## 4. What changed, by group

### Group 1 — Injection and query safety
- `term` is bound as a parameter in `grade.controller.js` and `pdf.controller.js`; values other than `term1|term2|term3` → 400.
- The finance summary year filter and the attendance `LIMIT` are now bound parameters. No other value interpolation into SQL remains (the remaining `${where}` fragments are built only from fixed text with `$n` placeholders).
- `utils/pagination.js`: `page` and `limit` must be integers; default 50, max 200; anything else → 400. Used for students, payments, documents and student attendance. No frontend page requests more than 200.
- **Existing bugs fixed because they blocked verification:** `GET /attendance/:classId/:date` was registered before `/student/:id` and `/report/:id` and captured them, so the student attendance history had never worked. The month/year filter on that endpoint also referenced a missing table alias.

### Group 2 — Auth and tokens
- Access token: 15 minutes. Refresh tokens carry a random `jti`; only `sha256(jti)` is stored in `refresh_tokens`.
- Revocation: logout revokes the current session; a password change revokes all sessions (and starts a fresh one); disabling an account revokes all sessions.
- `authenticate` reads the user row on every request (primary-key lookup), so disabling takes effect immediately, the role comes from the database, and `must_change_password` blocks every route except `POST /auth/change-password` (403 `PASSWORD_CHANGE_REQUIRED`).
- Deactivation rule: teacher `is_active=false` → login disabled + sessions revoked (re-enabled on `true`). Students: any status other than `active` (archive, PUT status, **graduation during promotion**) → login disabled + sessions revoked.
- Login rate limit: 5 failed attempts per 15 minutes per IP + email (successful logins don't count).
- CORS origins come from `CORS_ORIGINS`; `null` is rejected.
- New teachers: random 12-character temporary password, returned once in `data.temporary_password` (not in the message), with `must_change_password` set.

### Group 3 — Access control
- `middleware/studentAccess.middleware.js` (one reusable check): students may see only their own record and parents only linked children, on `/students/:id/summary`, `/attendance/student/:id`, `/grades/report-card/:id` and `/pdf/report-card/:id`.
- Finance: admin only.
- Private documents (`is_private`, with NULL treated as private): admin + uploader only, applied to the list, by-id, download, per-student list and category counts. Hidden documents return 404.
- Creating exams and entering grades require a `teacher_classes` assignment for that class + subject, and grades only for students in the exam's class. Admins are unrestricted.
- All 86 sites that return a 500 now send a generic message + `errors.error_id` and log the full error under that id (16 used to leak `err.message`, and 18 logged nothing).

### Group 4 — Schema and data integrity
- Migrations 010–015 (section 2).
- `scheduleExam` writes the exam and its schedule details in one transaction; the silent `.catch(() => {})` is removed; `end_time` must be after `start_time`.
- Finance accepts exactly the enum values (`tuition, registration, material, exam, library, sport, uniform, transport, other` / `term1–3`). An **unknown category or term now returns 400** instead of being silently replaced with tuition/term1.
- Student and teacher numbers come from sequences (10 parallel creates each → 10 unique numbers).
- Scores are validated 0..max_score before anything is written (a batch with one bad score saves nothing); `max_score` must be in (0, 999.99].
- `GET /students` returns `class_id`.
- Downloads use RFC 5987 `filename*=UTF-8''…`, and uploads decode filenames as UTF-8 (**multer's default was latin1, which garbled Amharic names when they were stored**).
- DATE columns are returned as `'YYYY-MM-DD'` strings; the exam calendar no longer shifts dates by a day in Ethiopian time.

### Group 5 — Minimal frontend stopgap
- `assets/js/escape.js`: the single `escapeHtml()`, applied to every API value placed in `innerHTML` on all 16 pages (inline handlers use `escapeHtml(JSON.stringify(v))`).
- `assets/js/config.js`: the only place the API base URL is set.
- `api.js`: refresh-on-401 with one shared refresh request; logs out only if the refresh fails; `logout()` calls `/auth/logout`; 403 `PASSWORD_CHANGE_REQUIRED` → `change-password.html`.
- `teachers.html`: the `Teacher@1234` text is removed; the temporary password is shown once in a modal with a copy button.
- `change-password.html`, `teacher-assignments.html` (new).
- **Follow-ups (`22d457b`):**
  - `parent-dashboard.html` uses the shared `api.js` (`window.ASMS_SESSION = 'parent'` selects `parent_token` and `parent-login.html`), so parents get token refresh and server-side logout. `change-password.html` keeps the parent session.
  - Document and parent report-card downloads go through `downloadFile()` (`authFetch` + blob), with the filename taken from `Content-Disposition` (RFC 5987 first), so Amharic names are kept. The backend exposes that header (`75d1010`).
  - Finance UI is admin-only: finance links and `[data-finance]` elements are removed for other roles, the dashboard and student pages skip finance requests, and `finance.html` sends non-admins to the dashboard.
  - Student pages read attendance `stats` (the API never returned `overall`).
- **Existing bug fixed:** both student-detail pages declared `const API_BASE` a second time, which stopped their script from running in a browser.

---

## 5. Verification (scratch DB, server on :3100 guarded to `asms_phase0_test`)

| Suite | Result |
|---|---|
| Group 1 (curl) | 17 checks: 8 expected 200, 9 expected 400 |
| Group 2 (curl) | 22 + 20 pass |
| Group 3 (curl) | 39 pass |
| Group 4 (curl + fresh-install simulation) | all pass, incl. Amharic filename round trip |
| Assignment endpoint (curl) | 10 pass |
| Group 5 (headless Edge via DevTools Protocol) | 55 pass: no JS errors on any page; XSS payloads render as text on students, documents, attendance and finance; assign → teacher can create an exam and grade only for that class + subject → remove → blocked again; temporary password modal; forced-change redirect; 5 parallel 401s → exactly 1 refresh; logout revokes server-side; `127.0.0.1` origin works |
| Parent portal (headless Edge) | 4 pass: login, child rendered, all tabs, no JS errors |
| Follow-ups (headless Edge) | 28 pass: parent portal refresh (3 parallel 401s → 1 refresh, `parent_token` only), parent logout and failed refresh → `parent-login.html`; report card downloads as `report-card-<number>.pdf` (real PDF); document `የተማሪ ሰነድ.pdf` downloads with its Amharic name; teacher B cannot download teacher A's private document; teachers see no finance panel, links or requests and are redirected away from `finance.html`, while admins still see them; attendance card shows 50% / 1 present / 1 absent. g5 (55), parent portal (4) and Group 1 re-run green afterwards. |

The test scripts live in the session scratchpad (temporary), not in the repos.

---

## 6. Skipped, out of scope, or needs your decision

**Needs a decision**
1. ~~Parent portal has no refresh-on-401.~~ **Fixed** in `22d457b`.
2. **Graduated students lose their login** (I applied the "any non-active status" rule). Say if graduates should keep read access.
3. **Student numbers no longer restart each year** (`ASMS-2027-007` can follow `ASMS-2026-006`). Restarting per year would need a per-year counter instead of one sequence.

**Existing problems seen but not changed (outside Phase 0 scope)**
4. ~~Document and report-card links return 401.~~ **Fixed** in `22d457b` (authenticated blob downloads).
5. ~~Finance panels show errors for teachers.~~ **Fixed** in `22d457b` (finance UI hidden from non-admins).
6. ~~Attendance card reads `overall`.~~ **Fixed** in `22d457b` (reads `stats`).
7. `GET /timetable/classes` returns classes from all academic years without the year, so identical class names look the same in dropdowns.
8. `PUT /exam-schedule/:id` ignores room and time, and the GET endpoints don't return `exam_schedules` details yet.
9. `GET /exam-schedule/upcoming?days=abc` → 500; a rejected file type on upload → 500 instead of 400.
10. The login rate limiter is in memory: it resets on restart, and behind a reverse proxy it needs `app.set('trust proxy', …)`.
11. Staff and parent logins in the same browser share one `refreshToken` cookie (the access tokens are now kept separately as `asms_token` / `parent_token`, but a refresh returns whichever user logged in last).
12. Documents uploaded earlier with non-ASCII names have garbled `file_name` values in the database; they were not repaired.
13. `npm audit` reports existing advisories (body-parser, brace-expansion); not upgraded.

**Housekeeping**
14. **`uploads/documents/1785622712537-341345.png` is in the Windows Recycle Bin** (deleted from that folder at 23:47 on 2026-10-07). My scripts and the backend delete with `fs.unlinkSync`, which never uses the Recycle Bin, so this looks like a delete through Explorer. It was not restored, in case that was intentional.
15. Scratch DB `asms_phase0_test` is kept. It contains test data, and its admin password is `Admin@1234` (set for testing). The temporary `fresh_install` schema used for the fresh-install test was dropped. `.env` was never edited, and `asms` was never connected to after you confirmed the scratch-DB setup.
