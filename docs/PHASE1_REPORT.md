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
- **Finance "Outstanding" showed 0.** The API returned `outstanding`, but the dashboards read `total_outstanding`. Both names are now returned (finance summary and analytics overview). Verified with your numbers: 23,600 − 22,600 = **1,000**, and the current `finance.html` shows it with no frontend change.
- **Zero-amount payments were rejected.** `recordPayment` refused amounts of 0, so a fee charged but not yet paid couldn't be recorded. Amounts must now be numbers ≥ 0.
- **`GET /api/parent/fees`:** each child's due / paid / balance / status (`paid`, `partial`, `unpaid`, `no_records`) plus family totals.
- **`GET /api/dashboard/teacher`:**
  - own classes (subjects, active student count)
  - today's attendance per class (marked / total / absent)
  - upcoming exams in the next 14 days
  - grading still to do for their own class + subject
  - today's timetable
  - no finance fields

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
| `POST /grades/exams` | A, T (own class+subject) | `max_score` in (0, 999.99] |
| `POST /grades` | A, T (own class+subject) | `{ exam_id, grades: [{ student_id, score, remarks }] }`; scores 0..max |
| `GET /grades/report-card/:id` | A, P, T, Pa, S | `?term=term1|term2|term3` |
| `GET /pdf/report-card/:id` | A, P, T, Pa, S | PDF |
| `GET /pdf/student-id/:id`, `GET /pdf/teacher-id/:id` | A | PDF |

### Exam schedule
| Method & path | Who | Notes |
|---|---|---|
| `GET /exam-schedule`, `/upcoming?days=`, `/calendar?month=&year=` | all | scoped to the user's classes |
| `GET /exam-schedule/class/:classId` | all (scoped) | |
| `POST`, `PUT /:id`, `DELETE /:id` | A | schedule includes `start_time`, `end_time`, `room`, `instructions` |

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
| `GET /finance/summary` | A, P | `total_expected`, `total_collected`, `total_outstanding` |
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
| `POST /accounts/parents/:parentId/children` | `{ student_id, relationship: father|mother|guardian|other, is_primary? }` |
| `DELETE /accounts/parents/:parentId/children/:studentId` | |
| `POST /accounts/principals` | `{ email, display_name }` → `temporary_password` |

---

## 5. Verification (scratch DB)

| Suite | Result |
|---|---|
| Group B role × endpoint matrix (6 users: admin, principal, teacher with/without assignments, student, parent) plus list-scoping checks | **218 pass** |
| Group C accounts (permissions, student/parent/principal creation, links, reset, audit) | **46 pass** |
| Group D (finance 23,600/22,600 → 1,000 via API and in `finance.html`, parent family fees, teacher dashboard) | **30 pass** |
| Phase 0 regression: curl suites (G1, G2 ×2, G3, assignments) and browser suites (G5 55, parent portal, follow-ups 28) | all pass |

---

## 6. Needs your decision

1. **Existing parents without a login.** `POST /accounts/parents` creates new parents. There is no endpoint to add a login to a parent row that already exists without one. Add `POST /accounts/parents/:parentId/login`?
2. **Deactivating parents and principals.** Teachers and students can be deactivated (logins disabled). For parent and principal accounts there's no deactivate endpoint yet, only password reset. Add `PUT /accounts/users/:userId { is_active }`?
3. **Staff notes hidden from students and parents.** I removed `notes` from student records for those two roles, as a conservative default. Confirm, or say whether they should see them.
4. **"Outstanding" is a net figure** (all due − all paid). An overpaying student hides other students' debt. Alternatives: the sum of positive balances only (matches `/finance/unpaid`), or show both.
5. **Graduated students lose their login** (Phase 0 rule, still open).

## 7. Notes for the current HTML frontend (no changes made)

- **Principal:** the current frontend shows finance only to admins, so a principal won't see the dashboard finance panel, and `finance.html` sends principals away. The API allows principal finance reads, so the React frontend can show them.
- **Teachers:** they now get 403 from `GET /teachers` (the Teachers page is an admin page anyway). The student, exam, attendance and timetable lists are now automatically limited to their own classes.

## 8. Go-live steps for Phase 1

1. Merge `phase-1-roles`, then `npm run migrate` (applies 016–017).
2. Create principal account(s) via `POST /accounts/principals`.
3. Create student and parent logins and parent ↔ student links via `/accounts`.
4. Make sure every teacher has class assignments (`teacher_classes`), as in Phase 0.
