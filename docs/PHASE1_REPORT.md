# ASMS Phase 1 — Roles and Accounts (backend)

Branch `phase-1-roles` in `asms-backend` (not pushed). Every change was verified against the scratch database `asms_phase0_test`; the real `asms` database was not touched, and `.env` was not edited.

---

## 1. Commits

| Commit | Summary |
|---|---|
| `54a7ce7` | **Group A.** `docs/PERMISSIONS.md`: the rulebook, definitions, and an audit of every route |
| `3995cda` | Your decisions for cases the table does not cover, recorded in `PERMISSIONS.md` |
| `4fcd056` | **Group B.** Principal role; scoping for teachers, students and parents; named role policies; all routes aligned |
| `df2187c` | **Group C.** School-created accounts (`/api/accounts`): student and parent logins, parent ↔ student links, principals, password reset |
| `d9779f6` | **Group D.** Finance outstanding fix, zero-amount payments, `GET /parent/fees`, `GET /dashboard/teacher` |
| `d3136cf` | `PERMISSIONS.md`: status after Phase 1 |
| `1aade6f` | **Addition 1.** One exam-creation rule for both exam endpoints (shared `services/exam.service.js`) |
| `094289f` | **Addition 2.** Admin can deactivate and reactivate a principal |
| `f07df7e` | **Decision 1.** Login for an existing parent |
| `106caaa` | **Decision 2.** Deactivate and reactivate parent accounts |
| `024f16b` | **Decision 4.** Outstanding = sum of per-student debts; `total_credit`, `net_balance` |

---

## 2. Migrations (run in this order)

`npm run migrate` applies only files not yet recorded in `_migrations` (001–015 are already applied on `asms`).

| # | File | What it does |
|---|---|---|
| 016 | `016_principal_role.sql` | Adds `principal` to the `user_role` enum |
| 017 | `017_user_display_name.sql` | Adds `users.display_name` (name for principals/admins, shown by `/auth/me`) |

Neither migration changes existing rows.

---

## 3. What changed

### Group A — Permission rulebook
- `docs/PERMISSIONS.md` contains the table, definitions ("own classes" = `teacher_classes`; "own children" = `student_parents`; "self" = `students.user_id`), the decisions below, and the route-by-route audit that guided Group B.

**Decisions taken with you:**

| Topic | Decision |
|---|---|
| Teacher directory | Admin + principal see all teachers; a teacher sees only their own record |
| Parent timetable | Kept: parents may view their child's class timetable |
| Exam schedules (read) | Like grades: admin + principal all; teacher own classes; parent children's classes; student own class |
| ID card PDFs | Admin only |
| Principal and documents | View, download and upload all; delete is admin only |
| Parent fees | New all-children endpoint with family total |
| Principal accounts | Admin creates them |
| Parents per student | No limit (at most one primary contact) |

### Group B — Principal role and enforcement
- **Migration 016:** adds `principal`.
- **`src/utils/scope.js`:** the one place that decides what a user may see (`classScope`, `canAccessClass`, `canAccessStudent`, `scopeCondition`).
- **Middleware** (`studentAccess.middleware.js`): `requireStudentAccess`, `requireClassAccess`, `requireOwnTeacher`.
- **Role policies** (`role.middleware.js`): `adminOnly`, `schoolLeaders`, `allStaff`, `teacherOrAdmin`, `parentOnly`, `allAuthenticated`.
- **Teachers are limited to their own classes** for:
  - viewing students
  - viewing and marking attendance (and every student in a marking request must be in that class)
  - exams and report cards
  - class timetables
  - their own profile and timetable
- **Students and parents** read their own (or their children's) records, class timetable and exam schedule. Internal staff `notes` are removed from student records for these two roles.
- **`/auth/me`** also returns `teacher_id`, `student_id` and `parent_id`.

### Group C — Accounts (admin only, no public sign-up)
- A login for an existing **active** student, and parent profiles with logins.
- Link and unlink parents and students (relationship, primary contact).
- Principal accounts (with display name).
- Password reset: new temporary password, forced change, all sessions revoked.
- **Account pattern:** every new login gets a random temporary password, returned **once** in `data.temporary_password`, with `must_change_password = TRUE`.
- **Audit:** all account actions are written to `audit_logs` (`account.*`).

### Group D — Fixes
- **Finance "Outstanding" showed 0.** The API returned `outstanding`, but the dashboards read `total_outstanding`. Both names are now returned (finance summary and analytics overview). Verified with your numbers: 23,600 − 22,600 = **1,000**, and the current `finance.html` shows it with no frontend change. Decision 4 later refined the definition (section 6).
- **Zero-amount payments were rejected.** `recordPayment` refused amounts of 0, so a fee charged but not yet paid couldn't be recorded. Amounts must now be numbers ≥ 0.
- **`GET /api/parent/fees`:** each child's due / paid / balance / status (`paid`, `partial`, `unpaid`, `no_records`) plus family totals.
- **`GET /api/dashboard/teacher`:**
  - own classes (subjects, active student count)
  - today's attendance per class (marked / total / absent)
  - upcoming exams in the next 14 days
  - grading still to do for their own class + subject
  - today's timetable
  - no finance fields

### Addition 1 — One rule for creating exams
Exam creation existed in two places with different rules and validation. Both endpoints now call `src/services/exam.service.js`:

- **Who may create:**
  - admin: any class
  - teacher: only a class + subject assigned in `teacher_classes`
  - principal, parent and student: 403
- **Same validation on both endpoints:**
  - required fields
  - `exam_type` and `term` values
  - `max_score` in (0, 999.99]
  - `YYYY-MM-DD` dates
  - `end_time` after `start_time`
  - class and subject must exist (404)
  - an active academic year is required (400; `/exam-schedule` used to fail with a 500)
- **Storage:** the exam and its schedule details are saved in one transaction.

**Which endpoint the React frontend should use: `POST /api/exam-schedule`.** It does everything the other one does, and also takes time, room and instructions and checks for clashes on the same date.

| Endpoint | Recommendation |
|---|---|
| `POST /api/exam-schedule` | **Use.** Date required; start/end time, room, instructions; conflict check |
| `POST /api/grades/exams` | **Deprecate.** Same rules (it calls the same service). Kept because the current `grades.html` uses it; responses carry `Deprecation: true` and `Link: </api/exam-schedule>`. Remove it once the old frontend is retired. |

One trade-off: `/exam-schedule` requires a date, while `/grades/exams` allows undated exams (for example an assignment). If the React frontend should create undated assessments, either use the due date as `exam_date`, or make the date optional on `/exam-schedule` before `/grades/exams` is removed (see section 6).

Editing and cancelling exams (`PUT`/`DELETE /exam-schedule/:id`) remain admin-only; the rule above covers creation.

### Addition 2 — Deactivate and reactivate a principal
- `PUT /api/accounts/principals/:userId/status` with `{ "is_active": true | false }`, admin only. It accepts principal accounts only; other users get 404.
- **Same cut-off as teachers** (it reuses `setUserActive`):
  - the login is disabled
  - every refresh session is revoked
  - an access token already issued is rejected on its next request
- Reactivating restores login with the same password; old sessions stay revoked.
- Both actions are recorded in `audit_logs`.

---

## 4. API for the new React frontend

### Conventions
- **Base URL** `/api`. Responses are `{ success, message, data }`; errors are `{ success: false, message, errors? }`.
- **Auth:** `POST /auth/login` returns `data.accessToken` (15 minutes) and sets an HTTP-only `refreshToken` cookie (`SameSite=Strict`). Send `Authorization: Bearer <token>`. On 401, call `POST /auth/refresh` once (with credentials) and retry; log out if that fails.
- **Forced password change:** `403` with `errors.code = "PASSWORD_CHANGE_REQUIRED"` means "show the change-password screen"; only `POST /auth/change-password` works until then.
- **Server errors:** `500` responses carry `errors.error_id` (also in the server log).
- **Pagination:** `?page=&limit=` (default 50, max 200), returned as `data.pagination`.
- **Dates:** DATE fields are `"YYYY-MM-DD"` strings.
- **Downloads:** `Content-Disposition` is readable cross-origin (RFC 5987 `filename*` for Amharic names).
- **CORS:** the frontend origin must be listed in `CORS_ORIGINS`.

Roles: **A** admin · **P** principal · **T** teacher (own classes) · **Pa** parent (own children) · **S** student (self).

### Session and profile
| Method & path | Who | Notes |
|---|---|---|
| `POST /auth/login` | all | `{ email, password }` → `accessToken`, `user { id, email, role, must_change_password }`; 5 failed attempts per 15 min |
| `POST /auth/refresh` | all | uses the cookie |
| `POST /auth/logout` | all | revokes the session |
| `GET /auth/me` | all | `full_name`, `role`, `teacher_id` / `student_id` / `parent_id` |
| `POST /auth/change-password` | all | `{ currentPassword, newPassword }` → new `accessToken`; other sessions revoked |

### Dashboards
| Method & path | Who | Notes |
|---|---|---|
| `GET /analytics/overview` (`/students`, `/attendance`, `/grades`, `/finance`) | A, P | whole school |
| `GET /dashboard/teacher` | T | own classes only |
| `GET /parent/children`, `GET /parent/child/:id/summary` | Pa | |
| `GET /students/:id/summary` | A, P, T, Pa, S | scoped |

### Students
| Method & path | Who | Notes |
|---|---|---|
| `GET /students` | A, P, T | `?search=&class_id=&status=&gender=&page=&limit=`; teachers get own classes only; includes `class_id` |
| `GET /students/:id` | A, P, T, Pa, S | scoped; `notes` omitted for Pa/S |
| `POST /students`, `PUT /students/:id`, `DELETE /students/:id` | A | DELETE archives (withdrawn) |

### Teachers and assignments
| Method & path | Who | Notes |
|---|---|---|
| `GET /teachers` | A, P | |
| `GET /teachers/:id` | A, P, T (own) | includes `subjects[]` and `classes[]` (with `subject_id`) |
| `GET /teachers/subjects` | A, P, T | |
| `POST /teachers` | A | returns `temporary_password` once |
| `PUT /teachers/:id` | A | `is_active:false` disables the login |
| `POST /teachers/:id/subjects` | A | `{ subject_ids: [] }` |
| `POST /teachers/:id/classes` | A | `{ class_id, subject_id }` |
| `DELETE /teachers/:id/classes/:classId/:subjectId` | A | |

### Attendance
| Method & path | Who | Notes |
|---|---|---|
| `POST /attendance` | A, T (own class) | `{ class_id, date, records: [{ student_id, status, note }] }` |
| `PUT /attendance/:id` | A | correction |
| `GET /attendance/:classId/:date` | A, P, T | class sheet for a day |
| `GET /attendance/report/:classId` | A, P, T | `?month=&year=` |
| `GET /attendance/student/:id` | A, P, T, Pa, S | `?month=&year=&limit=` |

### Exams, grades, report cards
| Method & path | Who | Notes |
|---|---|---|
| `GET /grades/exams` | A, P, T | teachers: own classes |
| `POST /grades/exams` | A, T (own class+subject) | **deprecated**, use `POST /exam-schedule`; date optional |
| `POST /grades` | A, T (own class+subject) | `{ exam_id, grades: [{ student_id, score, remarks }] }`; scores 0..max |
| `GET /grades/report-card/:id` | A, P, T, Pa, S | `?term=term1|term2|term3` |
| `GET /pdf/report-card/:id` | A, P, T, Pa, S | PDF |
| `GET /pdf/student-id/:id`, `GET /pdf/teacher-id/:id` | A | PDF |

### Exam schedule
| Method & path | Who | Notes |
|---|---|---|
| `GET /exam-schedule`, `/upcoming?days=`, `/calendar?month=&year=` | all | scoped to the user's classes |
| `GET /exam-schedule/class/:classId` | all (scoped) | |
| `POST /exam-schedule` | A, T (own class+subject) | **create exams here**: `{ class_id, subject_id, name, exam_type, term, exam_date, max_score?, start_time?, end_time?, room?, instructions? }` |
| `PUT /exam-schedule/:id`, `DELETE /exam-schedule/:id` | A | edit / cancel |

### Timetable and academic years
| Method & path | Who | Notes |
|---|---|---|
| `GET /timetable/classes`, `/timetable/subjects` | A, P, T | reference lists |
| `GET /timetable/class/:classId` | all (scoped) | |
| `GET /timetable/teacher/:teacherId` | A, P, T (own) | |
| `POST`, `PUT /:id`, `DELETE /:id` | A | |
| `GET /parent/child/:id/timetable` | Pa | |
| `GET /academic-years`, `/current`, `/:id/stats` | A, P | |
| `POST /academic-years`, `PUT /:id`, `POST /:id/activate`, `POST /:id/promote` | A | |

### Finance
| Method & path | Who | Notes |
|---|---|---|
| `GET /finance/summary` | A, P | `total_expected`, `total_collected`, `total_outstanding` (sum of per-student debts), `total_credit` (overpayments), `net_balance` (due − paid); `outstanding` = `total_outstanding` |
| `GET /finance/payments`, `/unpaid`, `/student/:id` | A, P | |
| `POST /finance/payments` | A | categories: tuition, registration, material, exam, library, sport, uniform, transport, other; terms: term1–3 |
| `GET /parent/fees` | Pa | all children + family total |
| `GET /parent/child/:id/fees` | Pa | one child with payment history |

### Documents
| Method & path | Who | Notes |
|---|---|---|
| `GET /documents`, `/categories`, `/student/:id`, `/:id`, `/download/:id` | A, P (all), T (own uploads + public) | |
| `POST /documents/upload` | A, P, T | multipart: `file`, `title`, `category`, `is_private`, `student_id?` |
| `DELETE /documents/:id` | A | |

### Accounts (admin only)
| Method & path | Notes |
|---|---|
| `GET /accounts/users?role=&search=` | includes profile ids |
| `POST /accounts/users/:userId/reset-password` | returns `temporary_password` |
| `POST /accounts/students/:studentId/login` | `{ email }` → `temporary_password` |
| `GET /accounts/parents?search=` | with `children[]` |
| `POST /accounts/parents` | `{ full_name, phone, email, phone_secondary?, occupation? }` → `temporary_password` |
| `POST /accounts/parents/:parentId/login` | `{ email }`: login for an existing parent without one → `temporary_password` |
| `PUT /accounts/parents/:parentId/status` | `{ is_active }`: deactivate (immediate cut-off, sessions revoked) / reactivate |
| `POST /accounts/parents/:parentId/children` | `{ student_id, relationship: father|mother|guardian|other, is_primary? }` |
| `DELETE /accounts/parents/:parentId/children/:studentId` | |
| `POST /accounts/principals` | `{ email, display_name }` → `temporary_password` |
| `PUT /accounts/principals/:userId/status` | `{ is_active }`: deactivate (immediate cut-off, sessions revoked) / reactivate |

---

## 5. Verification (scratch DB)

| Suite | Result |
|---|---|
| Group B role × endpoint matrix (6 users: admin, principal, teacher with/without assignments, student, parent) plus list-scoping checks | **220 pass** |
| Addition 1: both exam endpoints, same cases (8 roles/assignments × 6 invalid inputs each, storage, conflicts, deprecation headers, no active year) | **39 pass** (run twice) |
| Addition 2: principal deactivate/reactivate (permissions, immediate cut-off, session revocation, audit) | **16 pass** |
| Decisions 1, 2, 4: existing-parent login, parent deactivate/reactivate, per-student outstanding with overpayment | **35 pass**; accounts, principal, Group D and role matrix re-run green |
| Group C accounts (permissions, student/parent/principal creation, links, reset, audit) | **46 pass** |
| Group D (finance 23,600/22,600 → 1,000 via API and in `finance.html`, parent family fees, teacher dashboard) | **30 pass** |
| Phase 0 regression: curl suites (G1, G2 ×2, G3, assignments) and browser suites (G5 55, parent portal, follow-ups 28) | all pass |

---

## 6. Decisions (all answered)

| # | Topic | Options | Decision | Status |
|---|---|---|---|---|
| 1 | Existing parent without a login | A: add an endpoint · B: delete and recreate the parent | **A** | ✅ `POST /accounts/parents/:parentId/login` (`f07df7e`) |
| 2 | Deactivating parents | Add a status endpoint, or reset only | **Yes, admins can deactivate and reactivate** | ✅ `PUT /accounts/parents/:parentId/status` (`106caaa`), same cut-off as teachers/principals |
| 3 | Staff notes and students/parents | A: hidden · B: shown · C: split internal/shareable | **A** | ✅ Already implemented in Group B; no change |
| 4 | What "Outstanding" means | A: net · B: positive balances only · C: return both | **C** | ✅ `total_outstanding` = sum of per-student debts, plus `total_credit` and `net_balance` (`024f16b`) |
| 5 | Graduated students' login | A: disabled · B: read-only access · C: grace period | **A** | ✅ Phase 0 behaviour kept; no change |
| 6 | Undated exams | Optional date on `/exam-schedule`, or always required | **Always required** (assignments use the due date) | ✅ No change: `/exam-schedule` already requires it; `/grades/exams` stays deprecated and can be removed with the old frontend |

## 7. Notes for the current HTML frontend (no changes made)

- **Principal:** the current frontend shows finance only to admins, so a principal won't see the dashboard finance panel, and `finance.html` sends principals away. The API allows principal finance reads, so the React frontend can show them.
- **Teachers:** they now get 403 from `GET /teachers` (the Teachers page is an admin page anyway). The student, exam, attendance and timetable lists are now automatically limited to their own classes.

## 8. Go-live steps for Phase 1

1. Merge `phase-1-roles`, then `npm run migrate` (applies 016–017). Decisions 1, 2 and 4 need no migrations.
2. Create principal account(s) via `POST /accounts/principals`.
3. Create student and parent logins and parent ↔ student links via `/accounts`.
4. Make sure every teacher has class assignments (`teacher_classes`), as in Phase 0.
