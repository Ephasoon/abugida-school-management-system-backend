# ASMS Phase 2 — React frontend (plan)

*2026-10-14, revision 5 (answers to N1–N17 included) · **approved 2026-10-14**, M1 started · planning only, nothing built yet · awaiting approval*

Sources:
- `docs/PERMISSIONS.md` (who may do what)
- `docs/PHASE1_REPORT.md` §4 (API reference)
- `docs/BACKLOG.md`
- the current HTML frontend (`C:\asms\asms-frontend`), which keeps running
  until the new app covers everything it does

## Decisions (2026-10-14)

| # | Topic | Decision |
|---|---|---|
| D1 | Language | **English by default.** An Amharic switch on the login page (and in the top bar), saved per browser. English mode keeps the Amharic subtitles. Amharic mode shows **no** English subtitles. |
| D2 | Calendar | **Ethiopian calendar by default** for display **and** date entry, with a switch to Gregorian saved per browser. An Ethiopian date picker is built in M1 and used everywhere. The API and database stay Gregorian; the app converts. Academic years show both forms: "2019 E.C. (2026/2027)". Report cards and PDFs use the Ethiopian calendar. |
| D3 | Digits | Western digits everywhere. |
| D4 | Amharic names | Optional Amharic name fields for students, parents and teachers, and the PDF font fix (G9), both in Phase 2. |
| D5 | Sessions | One session per browser, one login page for everyone. |
| D6 | Missing endpoints | G1–G8 approved. Each is built in the backend, with tests, just before the milestone that needs it. |
| D7 | Student portal | **Phase 3**, not Phase 2. |
| D8 | Production | One domain, reverse proxy: app at `/`, API at `/api`. |
| D9 | `test:all` | Skips the `asms-web` suites with a clear message if the folder is missing. |
| D10 | Repository | Private `Ephasoon/abugida-school-management-system-web`, created by you. Needed at the start of M1 (§9). |
| D11 | Theme | Dark on screen, light styles for printing. |
| D12 | Switch-over | You sign off M10 after a school admin has tried it. Then the old frontend is unlinked and its repo archived. |
| D13 | School model | Two semesters, scores out of 100 with totals, averages and ranks (no GPA or letters), and monthly fees. These backend changes are planned in §5 and done before the grades and finance milestones. |
| D14 (N1) | Semester 2 start | Default **Yekatit 1** of the Ethiopian year the academic year falls in, i.e. the Ethiopian year of its `end_date` (e.g. 2019 E.C. → 2027-02-08; a year 2024-09-01 … 2025-07-31 is 2017 E.C. → 2025-02-08, although it starts on Nehase 26, 2016), editable per academic year. Undated `term2` exams migrate to **semester 2**. |
| D15 (N2) | Subject score | **Sum of the assessment scores.** Their max scores add up to 100 per subject per semester. **Refused** (400) when they would exceed 100 (D23); "incomplete" while below 100. |
| D16 (N3) | Ranking | Only students with a score in **every subject** of the class for that semester are ranked; others show "not ranked (incomplete)". **Ties: 1, 2, 2, 4.** |
| D17 (N4) | Pass mark | Pass = **yearly average ≥ 50**, stored as a **school setting** the admin can change. No PASS/FAIL is shown until the setting exists. |
| D18 (N5) | Score bands | 90–100, 80–89, 70–79, 60–69, 50–59, below 50. |
| D19 (N6) | Months charged | Monthly fees default to **10 months, Meskerem–Sene**. Each fee structure can choose its own months. |
| D20 (N7) | Old term payments | Kept as **legacy charges** (no month), not spread over months. Balances stay exactly the same. |
| D21 (N8) | Parent fees before M8 | The parent portal keeps the **current fee view until M8**, then switches to the monthly view. |
| D22 (N9) | Discounts | **Percentage or fixed amount**, per student and per fee structure, with a reason: sibling, staff child, scholarship, other. Entered manually by the admin; automatic sibling rules later. |
| D23 (N10) | Report card extras | Per semester: **days absent**, a **conduct grade A/B/C/D** entered by the homeroom teacher, and a short **homeroom teacher remark**. |
| D24 (N11) | Real data checks | Take a fresh backup of `asms`, restore it into a separate database (`asms_restore_check`), and run the dry runs there. **Never on `asms` itself.** |
| D25 (N12) | Max scores over 100 | **Refuse** (400 with a clear message) when a subject's max scores for a semester would exceed 100. |
| D26 (N13) | Promotion | Wording **"Promoted / Not promoted"** (ተዛውሯል / አልተዛወረም). For grades with regional or national exams, the admin records promotion **manually**; which grades those are is a school setting. |
| D27 (N14) | Fee due day | Default **the 10th** of each Ethiopian month, changeable per fee structure. |
| D28 (N15) | Days absent | Only `absent` counts as days absent; `late` and `excused` are shown separately. |
| D29 (N16) | Locking a semester | The admin can **lock** a semester after report cards are printed. Changing a locked semester's scores or conduct needs an **unlock**, recorded in the audit log. |
| D31 | Attendance rules (M4, 2026-10-15) | School days Monday–Friday (Saturday shown only when it has records); no holiday list yet (BACKLOG). No future dates; the date inside the class's academic year. Teachers mark own classes of the current year, today and the previous 3 days; older days through the admin. The admin marks any past date of a class's year (audited outside the teacher window) and corrects single records with a required reason (audited). The same rules apply to the old frontend. |
| D32 | Attendance rate (M4, 2026-10-15) | rate = (present + late) / (marked days − excused): late counts as attended, excused days are left out. The same rule everywhere: attendance, analytics, student summary, report card, parent portal, PDFs. |
| D30 (N17) | Homeroom teachers | Unknown today; the real-data check (D24) will show how many classes have one. The admin sets homeroom teachers in the new screen (M5). |

---

## 1. Stack

New folder **`C:\asms\asms-web`**, its own git repo. React 18 + Vite +
TypeScript (strict).

| Concern | Choice | Why |
|---|---|---|
| Router | **React Router** (v7, `createBrowserRouter`) | The most widely known React router, so it is easy to hire for and find answers about. Nested routes fit the layout (sidebar shell → page). Each route declares the permission it needs in `handle` (§3). TanStack Router is more type-safe but harder to learn; not worth it for a small team. |
| Server data | **TanStack Query** (v5) on top of a small typed `fetch` client | Caching, loading and error states, retries, and refetch on reconnect, without writing them by hand. That matters on slow networks (§6). We don't use React Router loaders for data, so there is one way to fetch. |
| API client | Own ~150-line `src/api/client.ts`: base URL, Bearer token, refresh-on-401, error mapping | The refresh rules are specific to ASMS (§2) and already proven in `asms-frontend/assets/js/api.js`. No axios. Response types are hand-written per module in `src/api/*.ts` (the backend has no OpenAPI spec). |
| Forms | **React Hook Form + Zod** | Few re-renders on long forms (attendance sheets, score entry). Zod schemas mirror the backend rules (score 0..max, required fields), and the inferred types are reused. Server field errors (`errors`, and the 400 "`class_id` does not exist" messages from BACKLOG) map onto the same fields. |
| Styling | **CSS Modules + global CSS variables** (the tokens from `main.css`) | Keeps the current look exactly (§8), adds no build plugins, and ordinary CSS is easy to read. No Tailwind and no component library. |
| Components | Small in-house kit in `src/ui/`: Button, Field, Select, Table, Card, Badge, Modal (native `<dialog>`), Toast, Skeleton, EmptyState, PageHeader, **EthDatePicker** | About 13 components cover every screen. Native `<dialog>` handles focus and Escape. |
| i18n | **i18next + react-i18next** | Standard, with plurals and interpolation. One JSON file per language and feature (§7). |
| Fonts | `@fontsource` packages for Sora, Noto Sans Ethiopic and JetBrains Mono, self-hosted | No request to Google Fonts (slow networks, offline LAN). |
| Tooling | ESLint + Prettier, `tsc --noEmit`, Vitest, Playwright (§9) | |

Folder layout (feature-first):

```
asms-web/
  src/
    app/         router, providers, layout (Shell, Sidebar, Topbar)
    auth/        session, permissions.ts, nav.ts, guards
    api/         client.ts + one file per backend module (students.ts, accounts.ts, ...)
    features/    accounts/, teachers/, students/, attendance/, exams/, results/,
                 timetable/, finance/, documents/, academic-years/, dashboards/, parent/
    ui/          shared components (incl. EthDatePicker)
    i18n/        en/*.json, am/*.json, setup.ts
    lib/         ethiopianDate.ts, format.ts (dates, ETB), download.ts
    styles/      tokens.css, base.css, print.css
  e2e/           Playwright tests
```

---

## 2. Authentication and sessions

Backend facts (Phase 0/1):
- `POST /auth/login` returns a 15-minute `accessToken` and sets an HTTP-only
  `refreshToken` cookie (`SameSite=Strict`).
- `POST /auth/refresh` and `POST /auth/logout` use that cookie.
- `GET /auth/me` returns the role and the `teacher_id`, `student_id` or
  `parent_id`.
- `403 errors.code = PASSWORD_CHANGE_REQUIRED` blocks every route except
  `POST /auth/change-password`.

Design:
1. **The access token lives only in memory** (a module variable in
   `auth/session.ts`), never in `localStorage`.
2. **After a reload or a new tab**, the app calls `POST /auth/refresh`
   (cookie) and then `GET /auth/me`, and shows a splash until both return. If
   the refresh fails, it goes to `/login`.
3. **Refresh on 401, one shared refresh:** the client holds a single
   `refreshPromise`. Every request that gets a 401 awaits it, then retries
   once. If the token already changed while the request was in flight, it
   retries without refreshing. If the refresh fails, it logs out. Test: five
   parallel 401s make exactly one `/auth/refresh` call.
4. **Forced password change:** `user.must_change_password` from the login, or
   any `PASSWORD_CHANGE_REQUIRED` 403, sends every route to
   `/change-password` until `POST /auth/change-password` succeeds (it returns
   a new access token; other sessions are revoked server-side).
5. **Logout:** `POST /auth/logout`, clear the token and the query cache, go
   to `/login`. A `BroadcastChannel` logs out other tabs too.
6. **One session per browser, one login page for every role** (D5). The role
   from `/auth/me` picks the layout. Logging in as someone else replaces the
   session. This also removes the Phase 0 limitation where `asms_token` and
   `parent_token` shared one cookie.
7. **Cookie and origin:** in development, Vite proxies `/api`, so the page and
   the API share an origin (§10). In production, the app and the API sit on
   one domain behind a reverse proxy (D8). Both work with `SameSite=Strict`.

---

## 3. Navigation from one permission map

Two files decide what a role sees. Pages never test `user.role` themselves.

**`src/auth/permissions.ts`** turns the PERMISSIONS.md table into
capabilities:

```ts
// One entry per PERMISSIONS.md row (and the decisions under it).
export const CAPABILITIES = {
  'dashboard.school':     ['admin', 'principal'],
  'dashboard.teacher':    ['teacher'],
  'dashboard.parent':     ['parent'],
  'students.view':        ['admin', 'principal', 'teacher'],   // teacher: own classes (backend scopes)
  'students.edit':        ['admin'],
  'teachers.view':        ['admin', 'principal'],
  'teachers.manage':      ['admin'],                           // incl. class assignments
  'attendance.mark':      ['admin', 'teacher'],
  'attendance.view':      ['admin', 'principal', 'teacher'],
  'results.enter':        ['admin', 'teacher'],
  'results.view':         ['admin', 'principal', 'teacher'],
  'exams.view':           ['admin', 'principal', 'teacher', 'parent'],
  'exams.manage':         ['admin'],                           // edit / cancel
  'finance.view':         ['admin', 'principal'],
  'finance.record':       ['admin'],
  'documents.view':       ['admin', 'principal', 'teacher'],
  'documents.upload':     ['admin', 'principal', 'teacher'],
  'documents.delete':     ['admin'],
  'setup.view':           ['admin', 'principal'],              // academic years, timetable, classes, subjects, fees
  'setup.manage':         ['admin'],
  'timetable.own':        ['teacher', 'parent'],
  'accounts.manage':      ['admin'],
  'audit.view':           ['admin'],
  'settings.manage':      ['admin'],                           // school settings (pass mark, manual promotion grades)
  'conduct.enter':        ['admin', 'teacher'],                // teacher: own homeroom class only (backend checks)
  'promotion.decide':     ['admin'],
  'idcards.print':        ['admin'],
  'password.own':         ['admin', 'principal', 'teacher', 'parent', 'student'],
} as const satisfies Record<string, readonly Role[]>;

export const can = (user: User, cap: Capability) => CAPABILITIES[cap].includes(user.role);
```

- **`src/auth/nav.ts`** lists the menu items. Each has a path, an i18n key, an
  icon, a group and one capability. The sidebar shows only the items `can()`
  allows.
- **Routes** declare the same capability:
  `{ path: 'accounts', handle: { cap: 'accounts.manage' }, lazy: ... }`. One
  `<RequireCapability>` wrapper shows a "not allowed" page for a route the
  role may not open, even if the URL is typed.
- **Buttons** inside pages use `useCan('students.edit')`.
- **The backend still enforces everything.** Record-level scope (own classes,
  own children) is not repeated in the frontend, and a 403 from the API still
  shows a clear message.
- A unit test checks the map against a copy of the PERMISSIONS.md table.

**Students in Phase 2:** the student portal is Phase 3 (D7). A student who
logs in to the new app sees a short "student portal coming soon" page, plus
change password and logout. The old frontend has no student portal either,
so nothing is lost.

---

## 4. Screens per role and the endpoints they use

Legend: **A** admin · **P** principal (view only) · **T** teacher (own classes)
· **Pa** parent (own children). ⚠ = gap G1–G10 (§4.5). **§5** = changes
with the Ethiopian school model.

### 4.1 Shared
| Screen | Roles | Endpoints |
|---|---|---|
| Login (with the Amharic switch) | all | `POST /auth/login` |
| Change password (forced or voluntary) | all | `POST /auth/change-password` |
| Session restore, logout | all | `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout` |
| My profile (read-only) | A, P, T, Pa | `GET /auth/me` (+ `GET /teachers/:id` for T, `GET /parent/profile` for Pa) |

### 4.2 Admin (principal sees the same screens read-only unless marked A)
| Screen | Roles | Endpoints |
|---|---|---|
| School dashboard | A, P | `GET /analytics/overview`, `/analytics/students`, `/analytics/attendance`, `/analytics/grades` (§5.2: score bands instead of letters), `/analytics/finance` (§5.3: per month) |
| **Accounts: users list** | A | `GET /accounts/users?role=&search=` |
| Accounts: reset password (temp password shown once) | A | `POST /accounts/users/:userId/reset-password` |
| Accounts: principals (create, deactivate, reactivate) | A | `POST /accounts/principals`, `PUT /accounts/principals/:userId/status` |
| Accounts: parents (list, create, add login, deactivate) | A | `GET /accounts/parents?search=`, `POST /accounts/parents`, `POST /accounts/parents/:parentId/login`, `PUT /accounts/parents/:parentId/status` |
| Accounts: link and unlink parent ↔ student | A | `POST /accounts/parents/:parentId/children`, `DELETE /accounts/parents/:parentId/children/:studentId`, picker `GET /students?search=` |
| Accounts: student login, disable/enable | A | `POST /accounts/students/:studentId/login`, ⚠ G6 `PUT /accounts/students/:studentId/status` |
| Audit log | A | ⚠ G8 |
| Teachers list, profile | A, P | `GET /teachers`, `GET /teachers/:id` |
| Teacher create and edit (Amharic name fields, temp password once, deactivate) | A | `POST /teachers`, `PUT /teachers/:id` (+ D4 name fields) |
| Teacher subjects and class assignments | A | `GET /teachers/subjects`, `GET /timetable/classes`, `POST /teachers/:id/subjects`, `POST /teachers/:id/classes`, `DELETE /teachers/:id/classes/:classId/:subjectId`. Warn before assigning a subject outside the teacher's list (BACKLOG decision 2026-10-11). |
| Students list | A, P, T | `GET /students?...` |
| Student detail (profile, parents, attendance, results, fees, documents) | A, P, T (no fees) | `GET /students/:id` (+ ⚠ G7 `parents[]`), `/students/:id/summary`, `/attendance/student/:id`, **results** (§5.2), `/finance/student/:id` (A, P; §5.3), `/documents/student/:id` |
| Student register, edit, archive (Amharic name fields) | A | `POST /students`, `PUT /students/:id`, `DELETE /students/:id` (+ D4) |
| ID cards | A | `GET /pdf/student-id/:id`, `GET /pdf/teacher-id/:id` (G9 font, Ethiopian dates) |
| Attendance: class sheet, monthly report | A, P, T | `GET /attendance/:classId/:date`, `GET /attendance/report/:classId?month=&year=` (the month picker shows Ethiopian months and sends the Gregorian range, §7.2) |
| Attendance correction | A | `PUT /attendance/:id` |
| Exam schedule (list, calendar, upcoming) | A, P, T, Pa | `GET /exam-schedule`, `/upcoming`, `/calendar`, `/exam-schedule/class/:classId` (§5.1: `semester`) |
| Exam create | A, T | `POST /exam-schedule` (§5.1: `semester`, max scores add up to 100 per subject, §5.2) |
| Exam edit, cancel | A | `PUT /exam-schedule/:id`, `DELETE /exam-schedule/:id` |
| Score entry | A, T | ⚠ G1 `GET /grades/exams/:examId`, `GET /grades/exams`, `POST /grades` |
| **Class results** (per semester and year: scores, totals, averages, ranks) | A, P, T | new, §5.2 |
| Report card (view, PDF) | A, P, T, Pa | changed, §5.2 |
| Timetable: class and teacher view | A, P, T | `GET /timetable/class/:classId`, `GET /timetable/teacher/:teacherId` |
| Timetable: manage slots | A | `POST /timetable`, `PUT /timetable/:id`, `DELETE /timetable/:id` |
| Academic years (list, current, stats; "2019 E.C. (2026/2027)") | A, P | `GET /academic-years`, `/current`, `/:id/stats` |
| Academic years (create, edit, activate, promote; semester dates §5.1) | A | `POST /academic-years`, `PUT /:id`, `POST /:id/activate`, `POST /:id/promote` |
| Classes and subjects setup | A (P view) | ⚠ G2, G3 |
| School settings (pass mark, manual promotion grades) | A (P view) | `GET /settings`, `PUT /settings/:key` (§5.2) |
| Conduct and remarks (per class, per semester) | A, homeroom T (P view) | `GET/PUT /results/class/:classId/conduct` (§5.2) |
| Promotion decisions (manual grades, overrides) | A | `PUT /results/class/:classId/promotion`, `PUT /results/student/:studentId/promotion` (§5.2) |
| Homeroom teacher of a class | A | `PUT /classes/:classId/homeroom` (§5.2) |
| Discounts | A (P view) | `/finance/discounts` (§5.3) |
| Fee structures (monthly and one-time) | A (P view) | ⚠ G4, as redesigned in §5.3 |
| Finance overview, payments, unpaid **per month** | A, P | changed, §5.3 |
| Record payment (months covered, receipt PDF) | A | changed, §5.3; ⚠ G5 receipt PDF |
| Documents | A, P, T | `GET /documents`, `/categories`, `/:id`, `/download/:id`, `POST /documents/upload`; delete A |

### 4.3 Teacher
| Screen | Endpoints |
|---|---|
| Teacher dashboard | `GET /dashboard/teacher` (§5.1: "grading to do" per semester) |
| My classes → students | `GET /students?class_id=` |
| Mark attendance | `GET /attendance/:classId/:date`, `POST /attendance` |
| Exams, score entry, class results, report cards | as in 4.2 (scoped by the backend) |
| My timetable | `GET /timetable/teacher/:teacherId` |
| Documents | as in 4.2 (own uploads + public) |

### 4.4 Parent (mobile-first)
| Screen | Endpoints |
|---|---|
| Children list + family fees (per month) | `GET /parent/children`, `GET /parent/fees` (§5.3) |
| Child dashboard | `GET /parent/child/:id/summary` (§5.2: no GPA; latest semester average and rank) |
| Child results: per semester and year, report card PDF | `GET /parent/child/:id/grades` (§5.2 shape), `GET /pdf/report-card/:id` |
| Child attendance | `GET /parent/child/:id/attendance` |
| Child fees: months paid/unpaid, payment history | `GET /parent/child/:id/fees` (§5.3) |
| Child timetable, exam schedule | `GET /parent/child/:id/timetable`, `GET /exam-schedule/upcoming` |

### 4.5 Gaps (all approved, D6)

Each is built in the backend with tests just before the milestone that needs
it (§6).

| # | Gap | Built before | Endpoint |
|---|---|---|---|
| G1 | Scores already entered for one exam | M5 | `GET /grades/exams/:examId` → exam + `grades[]` (A, T own class+subject; P read) |
| G2 | Classes: create, edit, homeroom teacher | M7 | `POST /classes`, `PUT /classes/:id` (A); list stays `GET /timetable/classes` |
| G3 | Subjects: create, edit (incl. `name_am`) | M7 | `POST /subjects`, `PUT /subjects/:id` (A) |
| G4 | Fee structures | M8 | `GET/POST/PUT /finance/fee-structures` (A; P read), **monthly / one-time** (§5.3) |
| G5 | Payment receipt PDF | M8 | `GET /pdf/receipt/:paymentId` (A; Pa own children) |
| G6 | Disable a student login without archiving | M1 | `PUT /accounts/students/:studentId/status` `{ is_active }` |
| G7 | Parents of one student | M3 | `parents[]` in `GET /students/:id` for A and P |
| G8 | Audit log viewer | M7 | `GET /accounts/audit?action=&user=&from=&to=&page=` (A) |
| G9 | Amharic text in PDFs | M5 (report cards) | Embed Noto Sans Ethiopic in `pdf.service.js` |
| G10 | Body ids answer 500 | M3 (first big forms) | BACKLOG "Validate ids in request bodies" (400 naming the field) |

---

## 5. Ethiopian school model (backend changes)

These are backend changes, each with migrations, tests on
`asms_phase0_test`, and a go-live step. They are done **before** the
milestones that show them: **B1 (semesters) and B2 (results) before M5;
B3 (monthly fees) before M8.**

**Data safety for every migration below:**
- It first prints what it will change (row counts per old value) in a
  dry-run mode.
- It is rehearsed on `asms_phase0_test` first.
- Then the real-data check (D24), each time just before going live:
  1. Take a fresh `pg_dump` of `asms`. This is read-only for `asms`.
  2. Restore it into a separate database, `asms_restore_check`, dropped and
     re-created each time.
  3. Run the dry run and then the migration there, and report the counts
     and before/after checks.
- Scripts that write refuse to run unless `DB_NAME` is `asms_phase0_test`
  or `asms_restore_check`, like `guard.sh` does today. **Nothing runs on
  `asms` itself** except the final migration you approve.
- On `asms` it runs only after you approve, with a fresh `pg_dump` taken
  just before.
- Old columns are kept read-only for one release, so a rollback is possible,
  and dropped in a later migration.

### 5.1 B1 — Two semesters instead of three terms

**Today:** enum `term_type ('term1','term2','term3')`, used by
`exams.term`, `fee_structures.term`, `payments.term` and the
`student_fee_summary` view. Code: `exam.service.js`, `examSchedule`,
`grade`, `finance`, `pdf`, `parent`, `dashboard` and `student` controllers;
old frontend `exam-schedule.html`, `grades.html`, `finance.html`,
`dashboard.html`. Tests: g4, g10 and fixtures send `term`.

**Change:**

| Table / object | Change |
|---|---|
| new enum `semester_type` | `('semester1','semester2')` |
| `academic_years` | add `semester2_start DATE NOT NULL` (semester 1 = `start_date` … day before; semester 2 = `semester2_start` … `end_date`). **Default: Yekatit 1** of the Ethiopian year the academic year falls in: the Ethiopian year of its **`end_date`**, not of `start_date` (D14; corrected 2026-10-15: a school year can start before Meskerem 1, e.g. 2024-09-01 = Nehase 26, 2016 starts the 2017 E.C. year, whose Yekatit 1 is 2025-02-08). E.g. 2019 E.C. (2026-09-11 … 2027-07-10) → 2027-02-08. The create/edit form pre-fills it and the admin can change it per year; it must fall between `start_date` and `end_date`. Existing years are backfilled with their Yekatit 1. If a request leaves it out (e.g. the old `academic-years.html`), the backend uses the default, so the old frontend keeps working. |
| `exams` | add `semester semester_type NOT NULL` (backfilled, below); `term` becomes nullable and read-only, then is dropped |
| `fee_structures`, `payments` | `term` is replaced by months (B3, §5.3), not by semesters |
| `student_fee_summary` view | replaced (B3) |

**Migrating existing exams:**
- An exam **with `exam_date`** gets the semester whose date range contains
  that date. This is the most reliable rule, because term numbers don't map
  cleanly onto two semesters.
- An exam **without a date**: `term1` → semester 1; `term3` → semester 2;
  `term2` → semester 2 (D14).
- The dry run lists each exam whose term and date disagree (e.g. `term1`
  with a date in semester 2) for you to check. **term3 data** is migrated
  like the rest and reported separately.

**Endpoints:**
- `POST /exam-schedule`, `POST /grades/exams` (deprecated),
  `PUT /exam-schedule/:id`: they accept `semester` (`1|2`). `term` is
  rejected with a clear 400 once the old frontend no longer needs it.
- Until then, `term` is accepted and mapped (`term1`→1, `term2`/`term3`
  →2), so `asms-frontend` keeps working.
- Read endpoints (`GET /grades/exams`, `/exam-schedule*`, report cards,
  parent grades, teacher dashboard) return `semester` (plus `term` while
  it exists). Filters change from `?term=` to `?semester=`.
- Validation messages, tests g4 and g10 and fixtures are updated.

**Built (M5a, 2026-10-16, migration 020):** as above, plus: the exam's year is its class's year (not the current one); a dated exam must lie inside that year and its date decides the semester (a disagreeing `semester` is a 400; the old `term` is not checked against the date); an exam without a date needs `semester` or `term`; new exams also store the matching `term` for the old pages; a trigger gives raw inserts without `semester` the same rule. Changing `semester2_start` moves dated exams to the other semester (refused while either semester is locked, from M5a C) and the response says how many moved; `GET /academic-years/:id/semester2-preview?semester2_start=` is the dry run. `term` is accepted until M10.

**Old frontend:** its term dropdowns keep working through the mapping above.
They are not rebuilt; the old frontend is retired at M10.

### 5.2 B2 — Results out of 100, totals, averages and ranks (no GPA, no letters)

**Audit (everywhere GPA or letters are used):**

| Where | What | Plan |
|---|---|---|
| DB: `grades.grade_letter`, function `calculate_grade_letter`, trigger `trg_set_grade_letter` / `set_grade_letter()` (006, re-created in 015 with the max-score check) | letter filled on every insert/update | Re-create `set_grade_letter()` as `check_grade_score()` **keeping the max-score check** (015), drop the letter part and `calculate_grade_letter`; drop `grades.grade_letter` after one release |
| `grade.controller.js` | `percentageToGrade`, `gradeToPoints`, GPA, `PASS/FAIL` by GPA ≥ 2.0, letters in `enterGrades` responses and the report card | Replace with the results service below |
| `pdf.controller.js` + `pdf.service.js` | report card: letters, grade points, GPA box, rank, PASS/FAIL | Rebuild the report card PDF from the results service: per-semester table, yearly table, Ethiopian dates, G9 font |
| `parent.controller.js` | `gradeToPoints`, GPA in the child summary, `grade_letter` in child grades | Return semester averages and ranks instead |
| `student.controller.js` (summary) | `grade_letter` in recent grades | Return score / max only |
| `analytics.controller.js` | grade distribution by `grade_letter` | Distribution by score band 90–100, 80–89, 70–79, 60–69, 50–59, below 50 (D18), a constant in the results service |
| Old frontend | `grades.html` (GPA, rank, letters), `parent-dashboard.html`, `student-detail.html`, `student-detail-new.html`, `analytics.html` (letter chart) | Not rebuilt. During the transition the API keeps returning `gpa`/`grade_letter` as `null`, so those pages show "—" instead of breaking. They are retired at M10. |

**Bug found during the audit:** the current PDF class rank (`pdf.controller.js`)
averages **all** grades a student ever had in the class, across all years
and terms. The new rank is per class, year and semester (below).

**How a subject score out of 100 is made:**
- **Decided (D15):** the assessments of one subject in one semester
  (quizzes, assignments, mid, final) have **max scores that add up to 100**,
  e.g. 10 + 10 + 20 + 60. The subject score is the **sum of the scores**. No
  scaling.
- **Exam create/edit is refused (D25)** when the subject's max scores for
  that class and semester would exceed 100. The response is a 400 naming the
  numbers, e.g. "Mathematics, Grade 9 A, semester 1: max scores would total
  110 (already 90 + this 20). The limit is 100." This applies to
  `POST /exam-schedule`, the deprecated `POST /grades/exams` and
  `PUT /exam-schedule/:id` (changing `max_score`, `semester` or the class).
  The check runs in `exam.service.js` inside the same transaction, so two
  teachers saving at once can't pass it together. The form shows the
  remaining points before saving.
- Existing exams that already total over 100 (after the B1 migration) are
  listed in the dry run and left as they are; the results show them as
  "over 100, check" until the admin fixes them.
- **"Incomplete"** is shown while the max scores for a subject add up to
  less than 100, or while the student has no score for one of its
  assessments.

**Per student, per semester (class = the exam's class, so promotion doesn't
change old results):**
- `subject_score` (0–100, 1 decimal)
- `total` = sum of subject scores
- `average` = total ÷ number of subjects
- `rank` in class

**Per student, per year:**
- `yearly_subject_score` = average of the two semester scores
- `yearly_average` = (semester 1 average + semester 2 average) ÷ 2
- `yearly_rank` by yearly average

**Rank rules:**
- **Who is ranked (D16):** students in the class who have a score in
  **every subject of the class for that semester**. Others show "not ranked
  (incomplete)". "Every subject" means every subject that has at least one
  assessment for that class and semester. For the yearly rank, both
  semesters must be ranked.
- **Ties (D16):** standard competition ranking. Equal values (rounded to 2
  decimals) share a rank, and the next rank is skipped: 1, 2, 2, 4.
- **Rank by average.** Because only complete students are ranked, all of
  them have the same subjects, so ranking by total gives the same order.
  Average is kept because the yearly rank is by yearly average.
- Shown as "Rank 2 of 36", where 36 is the number of ranked students. The
  report card also shows the class size, e.g. "(38 students, 2 not
  ranked)".
- Computed in SQL with `RANK() OVER (PARTITION BY class, year, semester
  ORDER BY ROUND(average, 2) DESC)` in one **results service**
  (`src/services/results.service.js`). Report cards, PDFs, class results,
  the parent portal and analytics all use it, so ranks can't disagree.

**Pass/fail (D17):**
- The GPA ≥ 2.0 rule is removed. Pass = **yearly average ≥ pass mark**.
- The pass mark is a **school setting** (`pass_yearly_average`, default 50)
  that the admin can change.
- **New table `school_settings`:** `key` (PK), `value` (JSONB),
  `updated_by`, `updated_at`. Changes are written to `audit_logs`. The B2
  migration creates it with `pass_yearly_average = 50`.
- **New endpoints:** `GET /settings` (all staff read; the parent portal gets
  the values it needs inside its results data) and `PUT /settings/:key`
  (admin; validated per key: the pass mark is a number from 0 to 100).
- **No promotion result is shown** while the setting is missing or empty,
  or while the student's year is incomplete (not ranked). It is therefore
  never shown before B2 is live.
- It is shown for the **year** only (semesters show averages and ranks),
  worded **"Promoted / Not promoted"** ("ተዛውሯል / አልተዛወረም") (D26).
  The code calls it `promotion`, not PASS/FAIL.
- **Grades with regional or national exams (D26):**
  - A second setting, `manual_promotion_grades` (a list of grade levels,
    e.g. `[6, 8, 12]`, empty by default), says which grades these are.
  - For those grades the pass mark is **not** applied. The admin records
    each student's promotion manually.
  - New table `promotion_decisions`: `student_id`, `academic_year_id`,
    `promoted` (boolean), `note`, `decided_by`, `decided_at`. Unique
    `(student_id, academic_year_id)`, audited.
  - New endpoints: `PUT /results/student/:studentId/promotion`
    `{ academic_year_id, promoted, note? }` (A), and a bulk form per class,
    `PUT /results/class/:classId/promotion`.
  - Until the admin decides, the report card shows "Promotion pending". A
    manual decision is also allowed for other grades, and then overrides
    the pass mark (e.g. after a re-sit).
- `POST /academic-years/:id/promote` (moving students to the next grade)
  uses the same promotion result instead of promoting everyone. How
  "Not promoted" students are handled there (stay in the same grade level)
  is shown in the dry run before promoting.

**Report card extras per semester (D23):**
- **Days absent:** counted from `attendance` rows with status `absent`
  within the semester's date range (§5.1) and the student's class. `late`
  and `excused` are shown separately and are not counted as absent (D28).
- **Conduct grade (A/B/C/D) and homeroom remark:**
  - New table `semester_conduct`: `student_id`, `academic_year_id`,
    `semester`, `class_id`, `conduct` (enum `A`–`D`), `remark` (up to 300
    characters, Amharic or English), `entered_by`, `updated_at`. Unique
    `(student_id, academic_year_id, semester)`.
  - **Who enters it:** the **homeroom teacher** of the student's class
    (`classes.homeroom_teacher_id`) and the admin. Principal, parents and
    students read it on the report card.
  - This is a new rule for `docs/PERMISSIONS.md`. Today the homeroom column
    grants nothing. It will grant **only** this: conduct and remark for the
    homeroom class. It adds no access to other data.
  - Enforced by a new `requireHomeroom('classId')` middleware next to the
    existing access checks.
- **Setting the homeroom teacher** is needed before M5. So this part of G2,
  `PUT /classes/:classId/homeroom` `{ teacher_id }` (A), moves forward into
  B2. The rest of G2 (create and edit classes) stays in M7.

**Locking a semester (D29):**
- New table `semester_locks`: `academic_year_id`, `semester`, `class_id`
  (NULL = the whole school), `locked_by`, `locked_at`. The admin locks
  after the report cards are printed.
- **While locked**, the backend refuses (409, "Semester 1 2019 E.C. is
  locked for Grade 9 A. Ask the admin to unlock it.") every change that
  would alter that semester's results:
  - `POST /grades` for its exams
  - creating, editing or cancelling its exams (incl. `max_score`)
  - `PUT /results/class/:classId/conduct`
  - manual promotion decisions for a locked year
- **Unlock** removes the lock row. Both lock and unlock are written to
  `audit_logs` (`results.semester_locked` / `results.semester_unlocked`,
  with who, when, and an optional reason). Re-locking afterwards is normal.
- One check, `assertSemesterUnlocked(client, classId, yearId, semester)`,
  in the results service, called by every write above inside its
  transaction.
- Report cards and PDFs printed from a locked semester show "Final" in the
  footer; unlocked ones show "Provisional".

**Endpoints (new / changed):**

| Endpoint | Who | Returns |
|---|---|---|
| `GET /results/student/:studentId?academic_year_id=` (new) | A, P, T, Pa (scoped like report cards) | per semester: subjects (score, max entered, complete?), total, average, rank / class size; yearly: per-subject yearly score, yearly average, yearly rank |
| `GET /results/class/:classId?academic_year_id=&semester=` (new) | A, P, T (own class) | the class sheet: students × subjects, totals, averages, ranks |
| `GET /grades/report-card/:studentId` | as today | becomes a thin wrapper over `/results/student` (same data); `?term=` → `?semester=` |
| `GET /pdf/report-card/:studentId?academic_year_id=` | as today | new layout: both semesters + year, Ethiopian dates, Amharic names (D4), G9 font |
| `GET /parent/child/:id/grades`, `/summary` | Pa | results shape instead of GPA/letters |
| `POST /grades` | A, T | response without `grade_letter` |
| `GET /analytics/grades` | A, P | score bands (D18): 90–100, 80–89, 70–79, 60–69, 50–59, below 50, by subject score per semester |
| `GET /settings`, `PUT /settings/:key` (new) | staff read; A write | school settings: `pass_yearly_average` (default 50), `manual_promotion_grades` (default empty) |
| `GET /results/class/:classId/conduct?academic_year_id=&semester=` (new) | A, P, T (homeroom or own class, read) | conduct + remark per student |
| `PUT /results/class/:classId/conduct` (new) | A, homeroom T | `{ academic_year_id, semester, entries: [{ student_id, conduct, remark }] }` |
| `PUT /results/student/:studentId/promotion`, `PUT /results/class/:classId/promotion` (new) | A | manual promotion (D26) |
| `PUT /classes/:classId/homeroom` (new, part of G2) | A | `{ teacher_id }` |
| `GET /results/locks?academic_year_id=`, `POST /results/locks`, `DELETE /results/locks/:id` (new) | A (P read) | lock / unlock a semester (whole school or one class), audited |

**Built (M5a B, 2026-10-16, migration 021):** `services/results.service.js` as above (ranks computed in the service with the same competition rule; hundredths as integers so sums don't drift). A subject is complete for a student when its max scores add up to exactly 100 and every assessment has a score; over 100 shows `over_100`. Students of a class are its active students plus anyone with a score in its exams. `GET /results/class/:classId?semester=1|2|year`, `GET /results/student/:studentId?academic_year_id=`, `GET /settings`, `PUT /settings/:key` (`{ value }`, audited `settings.updated`), G1 `GET /grades/exams/:examId`. The report card, parent summary and grades return the results; during the transition `gpa` and `grade_letter` are "—" (the old `student-detail.html` would show "0.00" for `null`). `/analytics/grades` returns `score_bands` per semester; `grade_dist` stays, empty. D25 is checked in `exam.service.js` under `pg_advisory_xact_lock` per class, subject and semester.

**Built (M5a C, 2026-10-16, migration 022):** `semester_conduct`, `promotion_decisions`, `semester_locks` (one lock per year, semester and class, one whole-school lock per year and semester). `services/locks.service.js` holds the checks: scores, exams (create, edit, cancel, moving into a semester), conduct, promotion decisions (refused while semester 2 is locked, the year's end), attendance marked or corrected inside a locked semester's dates (M5a decision 3), and a changed `semester2_start` (any lock in the year). The homeroom endpoint was dropped: `PUT /classes/:id` sets `homeroom_teacher_id` (M5a decision 1). The results carry each semester's conduct, remark and `final` (locked) flag. The promotion preview (M7a) gives each student's yearly result, `suggested_repeat` (not promoted) and `warnings` (incomplete, pending); the admin still decides (M5a decision 2).

**Built (M5a D, 2026-10-16):** the report card PDF is drawn from `studentResults`: subjects with semester 1, semester 2 and yearly scores ("*" incomplete, "check" over 100), total, average and "Rank n of m" per semester and year, the class size and how many are not ranked, days absent / late / excused, conduct and the homeroom remark, the yearly promotion when there is one, and per semester "Final" (locked) or "Provisional" in the footer. `?academic_year_id=` picks the year; the old `?term=` / `?semester=` are validated and print the same report card. The old PDF rank bug (all grades ever) is gone.

**Built (M5b, 2026-10-16, no migration):** for the screens: `POST /grades` rows `{ student_id, clear: true }` remove a saved score (the subject becomes incomplete; audited `grades.score_cleared` with the old score; 409 while locked); `GET /grades/exams/:id` returns the roster (`students`, with `in_class`) and `locked`; `GET /grades/exams` returns `subject_name_am`; `GET /classes` returns the year's dates and `semester2_start` (teachers can't read `/academic-years`); `GET /results/class/:id/conduct` returns `locked` and `homeroom_teacher_id`. Suite g30. Frontend (asms-web M5b): exams (list, Ethiopian calendar, create with points left, admin edit/cancel), score entry, class results, conduct, student Results tab + report card PDF, settings (pass mark, manual grades, locks), semester 2 start dry run, promotion wizard suggestions.

**Tests:** a new suite with fixed fixtures covers:
- totals, averages, both semesters, the yearly figures
- ties (1, 2, 2, 4) and incomplete students
- moving to the next grade not changing old ranks
- refusal over 100, including two exams saved at the same time
- days absent per semester
- conduct entry: the homeroom teacher may enter it; other teachers and the
  principal get 403
- pass mark and manual promotion grades, "Promotion pending"
- locked semesters: every write refused with 409, unlock audited, writes
  work again after unlock
- scoping: a parent sees only their own children

### 5.3 B3 — Monthly fees

**Today:**
- `fee_structures` has one row per `(year, grade_level, term, category)`;
  no endpoint uses it.
- `payments` has `term`, `category`, `amount_due` and `amount_paid` typed
  per payment, and a unique `receipt_number`.
- `student_fee_summary` groups by term.
- The finance summary, unpaid list, student balance, parent fees and
  analytics all add up `amount_due − amount_paid` per term or overall.

**Proposal (charges and payments kept apart, so "unpaid per month" is a
simple question):**

| Table | Purpose / columns |
|---|---|
| `fee_structures` (changed) | `academic_year_id`, `grade_level` (NULL = all), `category`, **`frequency` (`monthly` \| `one_time`)**, `amount`, **`months SMALLINT[]`** (Ethiopian month numbers the monthly fee is charged for; **default Meskerem–Sene = 1–10** (D19); each fee structure can pick its own months, e.g. transport 1–10, a summer class 11–12; empty for one-time fees), `due_day` (day of the Ethiopian month for monthly fees, **default 10** (D27), 1–30, capped at 5/6 for Pagume) or `due_date` (one-time). `term` dropped. Unique `(academic_year_id, grade_level, category)`. |
| **`student_charges`** (new) | What a student owes: `student_id`, `academic_year_id`, `fee_structure_id` (nullable for manual charges), `category`, **`eth_month SMALLINT NULL`** (1–13; NULL = one-time), `amount_due` (before discount), `discount_amount` and `discount_id` (the discount applied, a snapshot), `due_date` (from `due_day` of that Ethiopian month), `created_by`. Unique `(student_id, fee_structure_id, eth_month)`. Generated for all active students when a fee structure is saved or a student enrols (idempotent); admins can add or waive single charges. |
| **`student_discounts`** (new, D22) | `student_id`, `fee_structure_id` (the fee it reduces; one row per fee, so "tuition and transport" is two rows), `kind` (`percent` \| `amount`), `value` (percent 0–100, or ETB per charge), `reason` (`sibling` \| `staff_child` \| `scholarship` \| `other`), `note` (required for `other`), `from_month` / `to_month` (optional; whole year by default), `created_by`, `created_at`. Entered manually by the admin; audited. Automatic sibling rules are for later. |
| `payments` (changed) | A receipt: `student_id`, `receipt_number`, `payment_date`, `payment_method`, `reference`, `amount` (total received), `recorded_by`, `notes`. `term`, `category`, `amount_due` are replaced by allocations (kept nullable during the transition). |
| **`payment_allocations`** (new) | Which charges a payment covers: `payment_id`, `charge_id`, `amount`. One payment can cover several months (e.g. three months of tuition + transport) under **one receipt**. |
| `student_fee_summary` view | replaced by `student_month_balance` (per student × month: due, discount, paid, balance, status `paid` / `partial` / `unpaid` / `waived` / `not_due`) |

**Months follow the academic year:**
- Month 1 = Meskerem of the year's Ethiopian year, … 12 = Nehase, 13 = Pagume.
- The Gregorian date range of each month comes from the shared Ethiopian
  date converter. The backend gets the same converter as the app, both
  tested against one test-vector file.
- "Overdue" = the charge's due date has passed and the balance is > 0. The
  due date is `due_day` (default the 10th, D27) of that Ethiopian month,
  e.g. Tikimt 10, 2019 = 2026-10-20.
- **Discounts are applied when charges are generated.** Adding or changing
  a discount recalculates only **unpaid** charges, so paid months and
  printed receipts never change. A discount can't make a charge negative.
  Percent discounts are rounded to 0.01 ETB.

**Migrating existing payments (term-based):**
- No guessing of months. Each existing payment row becomes:
  - one **legacy charge** (`eth_month NULL`, `category` as before,
    `amount_due` as before, marked `legacy_term = 'term1|2|3'`)
  - a payment (same receipt number, date, method, amount paid)
  - an allocation between the two
- Old balances therefore stay exactly the same. The dry run checks that
  totals per student and per year match before and after.
- `fee_structures` rows (if any) are listed for you to re-enter as monthly
  or one-time. They can't be converted automatically.
- **Decided (D20):** legacy charges are not spread over months. The
  migration fails (and changes nothing) if any per-student or per-year total
  differs after the move.

**Endpoints (new / changed):**

| Endpoint | Who | Notes |
|---|---|---|
| `GET/POST/PUT /finance/fee-structures` (G4) | A; P read | monthly / one-time, months, amount |
| `POST /finance/fee-structures/:id/generate` | A | (re)generate charges for active students; idempotent |
| `GET /finance/charges?student_id=&eth_month=&status=` | A, P | |
| `POST /finance/charges`, `PUT /finance/charges/:id` (waive) | A | manual charge, waive one charge |
| `GET /finance/discounts?student_id=`, `POST /finance/discounts`, `PUT /finance/discounts/:id`, `DELETE /finance/discounts/:id` (new) | A; P read | per student and fee structure; recalculates unpaid charges |
| `POST /finance/payments` | A | `{ student_id, payment_date, payment_method, reference?, allocations: [{ charge_id, amount }] }`, or `{ months: [..], categories: [..] }` and the server allocates in month order; returns the receipt |
| `GET /finance/payments` | A, P | receipts with allocations |
| `GET /finance/unpaid?eth_month=&class_id=` | A, P | per month |
| `GET /finance/student/:id` | A, P | months × categories grid + one-time fees + payments |
| `GET /finance/summary?eth_month=` | A, P | per month and year to date; `total_outstanding`, `total_credit` and `net_balance` keep their meaning (PERMISSIONS decision 4) |
| `GET /pdf/receipt/:paymentId` (G5) | A; Pa own children | Ethiopian date, Amharic name, months covered |
| `GET /parent/fees`, `/parent/child/:id/fees` | Pa | months paid/unpaid per child, family total |
| `GET /analytics/finance`, `/analytics/overview` | A, P | per month |

**Old frontend:** `finance.html` records term-based payments. During the
transition, `POST /finance/payments` keeps accepting the old shape
(`term`, `category`, `amount_due`, `amount_paid`) as a one-off charge plus
payment, so it keeps working until M10.

**Tests:**
- a new suite: generation, discounts (percent and amount, changed
  mid-year without touching paid months), due day 10 and overdue, a
  payment covering three months, partial payments, unpaid per month,
  receipts, parent scoping
- the migration check (totals before = after)
- g4's finance cases and PERMISSIONS decision 4 numbers re-verified

---

## 6. Build order

Each milestone ends with: backend and frontend tests green in
`npm run test:all`, a short report, and your approval before the next one.
Backend work for a milestone is merged (with tests) before its frontend part.

| M | Frontend scope | Backend before it |
|---|---|---|
| **M1** | **Setup, login, layout, accounts.** Vite + TS project, lint, tokens, fonts, i18n (en + am, switch on the login page), **Ethiopian date converter + EthDatePicker** (with the Gregorian switch), API client with refresh, login, forced change password, logout, session restore, role-based layout and sidebar (placeholders for later screens; "coming soon" page for students), **admin account screens**: users list, create principal, create parent (+ login for an existing parent), student login + disable/enable, link/unlink parent ↔ student, reset password (temp password once, copy button), deactivate/reactivate principal and parent. Test harness wired into `test:all`. | G6 |
| M2 | **Teacher dashboard and class assignments.** Teacher dashboard; teachers list, create, edit (Amharic names), deactivate, subjects, class assignments with the out-of-list subject warning; my timetable (read). | D4 name fields (teachers, students, parents in one migration); BACKLOG "assignClass: validate input + audit" |
| M3 | **Students.** List, detail tabs (incl. parents), register, edit (Amharic names), archive, ID card PDF. | G7, G10 |
| M4 | **Attendance.** Teacher marking (draft kept locally), class sheet, monthly report by Ethiopian month, admin correction. | D31, D32 |
| M5 | **Exams and results.** Exam schedule (semester), create exam (remaining points shown; over 100 refused), admin edit/cancel, score entry, class results sheet (incomplete / not ranked), report card view + PDF (days absent, conduct, remark, Promoted / Not promoted), **conduct entry** for homeroom teachers, **promotion decisions**, **homeroom teacher** setting, **lock / unlock semester**, **school settings screen**. | **B1, B2** (incl. `school_settings`, `semester_conduct`, `promotion_decisions`, `semester_locks`, homeroom endpoint, PERMISSIONS.md update), G1, G9 |
| M6 | **Parent portal** (mobile-first): children, child dashboard, results per semester and year with rank, attendance, timetable, exams. Fees keep the **current view** (`/parent/fees`, `/parent/child/:id/fees` as today) until M8 (D21). | |
| M7 | **School dashboards and setup.** Analytics (score bands), timetable management, academic years (both year forms, semester dates, activate, promote), classes, subjects, audit log. | G2, G3, G8 |
| M8 | **Finance.** Fee structures (months, due day), discounts, charges, record payment (months, receipt PDF), payments, unpaid per month, student and family balances; principal read-only; parent fees. | **B3**, G4, G5 |
| M9 | **Documents.** List, categories, upload, download (Amharic file names), delete. | |
| M10 | **Parity and switch-over.** Print styles everywhere, a page-by-page parity checklist against `asms-frontend`, a trial by a school admin, then your sign-off (D12). Then: unlink the old frontend, archive its repo, remove `POST /grades/exams`, the `term` compatibility mappings and the kept-for-rollback columns (`exams.term`, `grades.grade_letter`, `payments.term/category/amount_due`). | cleanup migration |

---

## 7. Ethiopia-specific

### 7.1 Amharic and English (D1)
- Every visible string goes through `t('key')`; a lint rule
  (`i18next/no-literal-string`) enforces it. Files:
  `src/i18n/{en,am}/{common,auth,accounts,...}.json`. A test fails if a key
  exists in one language and not the other.
- **Default English.** The switch on the login page and in the top bar is
  saved per browser (`localStorage`).
- **Subtitles:** in English mode every page header shows its Amharic
  subtitle (e.g. *Students* · "ተማሪዎች"). In Amharic mode it shows the
  Amharic title only, with no English subtitle.
- Data shows as entered. In Amharic mode: subject `name_am` and the Amharic
  name fields (D4) are shown when present, with a fallback to the Latin
  fields. In English mode, Latin names are shown and the Amharic name is
  shown as a secondary line on detail pages and ID cards.
- Numbers: Western digits (D3). Money: `ETB` / "ብር", 2 decimals.

### 7.2 Ethiopian calendar (D2)
- **One converter**, `ethiopianDate` (Gregorian ↔ Ethiopian via Julian Day
  Number, no dependency). The app has it in TypeScript, the backend in JS
  for PDFs and fee months.
- Both are tested against **one shared test-vector file**:
  - Meskerem 1 on Sep 11 and on Sep 12 (the year before a Gregorian leap
    year), e.g. 2026-09-11 = Meskerem 1, 2019 and 2027-09-12 = Meskerem 1,
    2020
  - Pagume 5 / Pagume 6 (Ethiopian leap year = year mod 4 = 3, e.g. 2019
    E.C. has Pagume 6 = 2027-09-11; the published anchor 2015 E.C. Pagume 6
    = 2023-09-11, Meskerem 1 2016 = 2023-09-12)
  - Ethiopian years come from the Amete Mihret era (Beyene–Kudlek
    formula). Checked while planning: 2026-10-14 = Tikimt 4, 2019.
  - month boundaries, Gregorian Feb 29, and round trips for every day
    1900–2100
- **Display:** Ethiopian by default ("ጥቅምት 4 2019" / "Tikimt 4, 2019");
  the Gregorian switch is saved per browser. Month names come from the i18n
  files.
- **Entry:** `EthDatePicker`, built in M1 and used for every date field.
  - Year, month (13 months, Pagume 5 or 6 days) and day grid.
  - It shows the matching Gregorian date underneath.
  - It sends `YYYY-MM-DD` Gregorian to the API.
  - In Gregorian mode it is a Gregorian picker with the same component API.
- **Ranges and months:** the attendance report, finance months and the
  calendar are chosen as Ethiopian months and sent as Gregorian ranges (or
  `eth_month` for fees).
- **Academic years:** "2019 E.C. (2026/2027)". The E.C. year is that of
  `end_date` (the Ethiopian year the school year falls in; corrected
  2026-10-15: `start_date` can fall before Meskerem 1, e.g. 2024-09-01 is
  Nehase 26, 2016, but 2024/2025 is 2017 E.C.), and the Gregorian part is
  the stored `name`. The same rule in the app, the PDFs and the semester-2
  default (D14).
- **PDFs** (report card, ID cards, receipts): dates in the Ethiopian
  calendar, done by the backend converter.

### 7.3 Amharic names and printouts (D4)
- One migration, optional (nullable) fields:
  - students: `first_name_am`, `fathers_name_am`, `last_name_am`
  - teachers: `first_name_am`, `last_name_am`
  - parents: `full_name_am`
- Searchable in the student, teacher and parent lists.
- G9: Noto Sans Ethiopic is embedded in `pdf.service.js`, so Amharic names,
  subjects (`name_am`) and the school name print correctly. Tested by
  extracting the text from a generated PDF.
- Browser print views (class lists, results sheets, attendance sheets) use
  `print.css`: light background, black text, no sidebar (D11).
- Downloads keep the RFC 5987 Amharic file names.

### 7.4 Slow and unreliable networks
- **Initial bundle budget: ≤ 200 KB gzip.** Each role's screens are
  lazy-loaded, so a parent never downloads admin code. Fonts are
  self-hosted and subset, with `font-display: swap`.
- TanStack Query shows cached data first and refreshes in the background;
  it refetches on reconnect.
- **GET requests retry** twice with backoff. **POST/PUT/DELETE never retry
  on their own:** the user sees "not sent, try again" with their input kept.
- A 20 s request timeout gives a clear message. An offline banner appears
  when the connection drops.
- Skeletons instead of blank pages. Lists are paginated (50).
- Attendance and score-entry drafts are saved to `localStorage` until they
  are submitted.
- Production: brotli/gzip and long cache headers on hashed assets (through
  the reverse proxy).
- Full offline mode / PWA: not in Phase 2.

---

## 8. Design

- **Dark on screen, light for print (D11).** `src/styles/tokens.css` copies
  the `main.css` variables as they are (`--bg #07090f`, `--card #111827`,
  `--gold #F5A623`, `--teal`, `--blue`, `--purple`, `--red`, `--green`, text
  greys, `--radius 14px`, sidebar 260px).
- Fonts as today: **Sora** (UI), **Noto Sans Ethiopic** (Amharic),
  **JetBrains Mono** (numbers, student numbers, scores).
- The logo keeps "አቡጊዳ ትምህርት ቤት". Subtitles follow D1 (§7.1).
- Responsive: sidebar on desktop, drawer on phones; parent screens designed
  for phones first.
- Accessibility basics: visible focus, labels on all fields, WCAG AA
  contrast (check `--text3`), keyboard-usable modals and date picker.

---

## 9. Testing

| Layer | Tool | What |
|---|---|---|
| Static | `tsc --noEmit`, ESLint | types, untranslated strings |
| Unit / component | **Vitest + Testing Library + MSW** | API client (one refresh for five parallel 401s, retry once, logout on refresh failure, `PASSWORD_CHANGE_REQUIRED` redirect); `permissions.ts` against the PERMISSIONS.md table; sidebar per role; **Ethiopian converter on the shared test vectors**; EthDatePicker (Pagume 5/6, month change, keyboard); Zod rules; en/am key parity; temp-password modal |
| Browser (end to end) | **Playwright**, `channel: 'msedge'` (installed Edge, no download) | Real backend on **:3100 / `asms_phase0_test`** through `guard.sh`. App from `vite preview` on **:5600**. Existing fixtures (`tests/g3.json`, `Admin@1234`); new data with unique suffixes. Per milestone: each role sees only its menu; a forbidden URL shows "not allowed"; the milestone's screens work end to end (M1: create principal → temp password → forced change → login; parent create + link; reset; deactivate cuts off the session; dates entered with the Ethiopian picker arrive as the right Gregorian date). |
| Backend | existing suites + new ones per gap / B-change | G1–G10 and B1–B3 each get a suite like g13. Migrations are tested on the scratch DB with a before/after check. |

**Fitting `npm run test:all`** (the backend repo stays the single entry
point):
- `tests/regress.sh` gets two suites:
  - `w1`: `npm test` in `asms-web` (static + unit, no server).
  - `w2`: Playwright against :3100, with the preview on :5600.
- `WEB_DIR` defaults to `../asms-web`. **If the folder is missing, both
  print "SKIP w1/w2: asms-web not found at <path> (set WEB_DIR)" and do not
  fail** (D9).
- Port 5600 joins the busy-port check. `CORS_ORIGINS` in `regress.sh` gets
  `http://localhost:5600`.
- `asms-web` also has `npm test` and `npm run test:e2e` for working inside
  that repo.

**Repository (D10):** I need `Ephasoon/abugida-school-management-system-web`
(private, empty, no README) **when M1 starts**. I'll ask for it then; nothing
is pushed before.

---

## 10. Development setup

| What | Port | Notes |
|---|---|---|
| Backend (dev, real `asms`) | 3000 | unchanged |
| Old HTML frontend | 5500 / 5501 | unchanged until M10 |
| **New app, dev** (`npm run dev` in `asms-web`) | **5173** | Vite proxies `/api` → `http://localhost:3000` |
| Test backend (scratch DB) | 3100 | unchanged |
| Old frontend tests (static) | 5599 | unchanged |
| **New app, tests** (`vite preview`) | **5600** | proxy `/api` → `:3100` |
| Edge DevTools (old browser tests) | 9333 | unchanged |

- **No `.env` / `CORS_ORIGINS` change is needed for development.** Thanks to
  the proxy, the browser sees one origin (`localhost:5173`), and the
  `SameSite=Strict` cookie is sent. The old frontend keeps using
  `CORS_ORIGINS` (default 5500/5501).
- Tests: only `regress.sh` gets `http://localhost:5600` added to
  `CORS_ORIGINS`.
- **Production (D8):** one domain. The reverse proxy (e.g. nginx) serves the
  built app at `/` (with fallback to `index.html` for client routes) and
  sends `/api` to Express. No CORS needed. `VITE_API_BASE` stays `/api`.
- Side by side: backend 3000, old app 5500, new app 5173. Both share the
  refresh cookie on `localhost`, so logging in on one can replace the
  other's session (as today).

---

## 11. Open questions

All answered: 1–12 (D1–D12) and N1–N17 (D14–D30). New questions will be
raised at the milestone checkpoints.
