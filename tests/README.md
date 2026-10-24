# ASMS backend tests

End-to-end suites from Phase 0 and Phase 1. They start the backend on port
**3100** against the scratch database **`asms_phase0_test`** and call the real
API. The browser suites also serve `asms-frontend` on port **5599** and drive
headless Edge.

## Safety: scratch database only

Everything goes through `guard.sh`. It forces `DB_NAME=asms_phase0_test` and
aborts if the name is anything else. `tdb.js`, the only direct database
connection the tests use, checks the same thing. The suites never read or
write the real `asms` database. Do not remove these guards.

## Requirements

- Windows with **Git Bash** (the scripts use `cygpath`, `netstat` and
  `powershell`).
- PostgreSQL with `asms_phase0_test`: all migrations applied, the Phase 0
  fixtures loaded, and the admin password `Admin@1234`.
- `.env` in the backend root. Only its credentials are used; `DB_NAME` is
  always overridden.
- `asms-frontend` checked out next to this repo (`../asms-frontend`), or set
  `FRONTEND_DIR`.
- Microsoft Edge for the browser suites (g5, g5b, g6, g9, w2). Set `EDGE_PATH` if
  it isn't in the default location.
- For w1 and w2: the new React app `asms-web` next to this repo (`../asms-web`,
  with `npm install` done), or set `WEB_DIR`. If it is missing, w1 and w2 are
  reported as SKIP and do not fail the run.
- Ports 3100, 5599, 5600 and 9333 free. The runner stops with a message if any
  is in use. The live server on 3000 and the dev app on 5173 are not touched.

## Run

```
npm run test:all            # every suite, from cmd, PowerShell or Git Bash
npm run test:all -- g7 g8   # only some suites
bash tests/regress.sh g3    # directly from Git Bash
```

The runner restarts the server for each suite and prints one line per suite.
It exits 1 if any suite fails or crashes. Full output is in `tests/<suite>.out`.
`npm run test:all` uses Git Bash (`tests/run.js`), because plain `bash` from
cmd.exe is usually WSL's. Set `GIT_BASH` if Git is installed somewhere unusual.

## Suites

| Suite | Covers |
|---|---|
| g1 | Phase 0 Group 1: SQL injection via `term`, pagination limits |
| g2 | Phase 0 Group 2: login, 15-minute token, refresh and logout, temporary passwords, must-change-password, immediate deactivation |
| g2b | Phase 0 Group 2: archive, suspension and graduation cut off student logins; old refresh tokens rejected; CORS; login rate limit |
| g3 | Phase 0 Group 3: student/parent record access, finance admin-only, private documents, grade writes limited to assignments, generic 500s with logged error id |
| g4 | Phase 0 Group 4: exam schedules, finance categories, number sequences, score limits, Amharic download names, dates as YYYY-MM-DD |
| g4b | Teacher assignments: assign, list, remove |
| g5 | Phase 0 Group 5 (browser): page smoke test, XSS escaping, assignment screen, one-time password, must-change redirect, refresh-on-401, logout, 127.0.0.1 origin |
| g5b | Parent portal (browser) |
| g6 | Phase 0 follow-ups (browser): parent portal on `api.js`, downloads, finance UI hidden from teachers, attendance card |
| g7 | Phase 1 Group B: role × endpoint matrix, list scoping |
| g8 | Phase 1 Group C: school-created accounts |
| g9 | Phase 1 Group D: finance outstanding, parent fees, teacher dashboard: classes, grading to do, upcoming exams and today's timetable of the current year only (in its own class 9E of a year containing today, made current while it runs; 2024/2025 put back and the assignment, timetable slot, students and exams removed afterwards, `todayyear.js`) |
| g10 | Phase 1 Addition 1: one rule for creating exams |
| g11 | Phase 1 Addition 2: deactivate and reactivate a principal |
| g12 | Phase 1 Decisions 1, 2, 4: existing-parent login, parent (de)activation, outstanding |
| g13 | Malformed and unknown ids on every route with an id parameter: 404 (403 where the user may not access the id), never 500 |
| g14 | Phase 2 G6: disable and enable a student login without archiving (immediate cut-off, archived students stay cut off, editing the student keeps it, audit) |
| g15 | Phase 2 M2: teacher class assignments: teacher active, class and subject exist (400 naming the field), 409 on duplicates (also five at once), subjects outside the teacher's list allowed, audit entries for assign and remove |
| g16 | Phase 2 D4 (migration 018): optional Amharic names for teachers, students and parents: saved, changed or cleared only when sent, length checked, searchable, returned by the lists; teacher list `status=active\|inactive\|all` and `subject_ids`; teacher edit clears phone / specialization / qualification; deactivate, reactivate and subject changes audited |
| g17 | Phase 2 G10: malformed and unknown ids in request bodies on every write route answer 400 "<field> does not exist." (array entries named, e.g. `grades[1].student_id`), nothing written, no file left behind; missing ids keep the route's own message; 403s first; refused upload file type 400 |
| g18 | Phase 2 G7: parents of one student in `GET /students/:id` (relationship, primary contact first, then by name, Amharic name) for admin and principal; teacher of the class as before, other teachers 403; no parents = [] |
| g19 | Phase 2 G9: backend Ethiopian date converter against the shared vectors (same file as asms-web, every day 1900–2100); student and teacher ID cards print the Amharic name and Ethiopian dates (text extracted with pdfjs-dist), Noto Sans Ethiopic embedded, no Helvetica; report card still renders |
| g20 | Phase 2 M3: students list (status=all, filters combine, bad status / gender / class_id 400, teachers own classes only, paging) and student edit (only fields sent change, optional fields incl. class and birth date cleared, names not emptied, bad values 400, audited), archive |
| g21 | Phase 2 M7a: academic years: name YYYY/YYYY matching the start year, end after start, duplicates 409 (create and edit), activate in one transaction with its audit entry, delete only an unused year; principal 403 |
| g22 | Phase 2 M7a (G2): classes per year: list (default current year), create and edit (grade, section, capacity, homeroom teacher; 409 duplicates; year fixed; audited), copy classes from another year (idempotent, no students, optional homerooms and teacher assignments); class lists, teacher dashboard and profile show the current year only |
| g29 | Phase 2 M5a (D): the report card PDF from the results (text extracted): both semesters and the year, scores out of 100, averages, "1 of 2", class size and not ranked, days absent, conduct and the Amharic remark, Promoted, Final / Provisional, Amharic names, Ethiopian dates, no GPA or letters; incomplete students; a yearly subject score marked "*" unless both semesters are complete ("—" without scores), Total "—" for the year; "No results yet"; old ?term= |
| g30 | Phase 2 M5b: clearing a saved score (`POST /grades` with `{ student_id, clear: true }`): the subject becomes incomplete, audited with the old score, refused in a locked semester (409), clear + score in one row (400), teacher scope (403); `locked` and the roster (`students`) on `GET /grades/exams/:id`; the year dates on `GET /classes`; `locked` on `GET /results/class/:id/conduct` |
| g31 | Timetable conflicts per academic year: a teacher's slot in another year's class does not block the same day and period (create and edit), one in the same year does (409); a class's own slot always blocks (409 on edit too, was a database error); an edit does not conflict with itself; day and period checked on edit |
| g32 | Phase 2 M6 (backend): `/parent/children` with Amharic names, class, year and `year_is_current` (archived children listed with their status); `GET /attendance/student/:id?from&to` (an Ethiopian month across two Gregorian months, at most 62 days, bad dates 400; month/year still works); a parent gets 403 for another family's child or class on every endpoint the portal uses (parent routes, results with the `years` for the picker, report card PDF, attendance, class exams and timetable, student); upcoming exams and fees scoped; no teacher phone or email in any parent response; a child without a class: `GET /results/student/:id` 200 with an empty result (`class`, `academic_year`, `semesters`, `year` null, no years), still 403 for another family and 404 for an unknown student |
| g33 | Phase 2 M7 (G3, migration 023): subjects: list with usage and `?status=`, create and edit (codes upper case and unique ignoring case, Amharic name, grade, only the fields sent), deactivate and reactivate, delete only an unused subject (409 with the usage), all audited; an inactive subject refused for new slots, class assignments, teacher subject lists (one already there may stay) and exams, its data kept; principal and teacher 403 on writes; the `period_times` setting (validated, sorted, audited) |
| g34 | Phase 2 M7: timetable management: slot create, edit, delete audited with names and old values; edits change only the fields sent (teacher and room cleared with null, times checked); a deactivated teacher refused; `GET /timetable/conflicts` (same year only); teacher timetable `?academic_year_id=`; `POST /timetable/copy` (only into an empty class, teachers kept only when free in the target's year, inactive subjects skipped, both reported, from last year's class, two at once: one 409, one audit entry) |
| g35 | Phase 2 M7: `GET /dashboard/school` (current year only: today's attendance per class marked / partly / not marked / no students, upcoming exams with times, score bands per semester, this year's fees; principal 200, teacher 403; a year containing today made current while it runs) and `GET /accounts/audit` (date range, user, action, target type, newest first, paging, user and target labels incl. Amharic, filter lists, bad input 400, admin only) |
| g28 | Phase 2 M5a (C): conduct by the homeroom teacher (others 403), manual promotion decisions ("pending", override), semester locks: scores, exams, conduct, decisions, attendance and a changed semester 2 start refused with 409, unlock audited, writes working again; the promotion preview with the yearly results (suggested repeat, warnings) |
| g27 | Phase 2 M5a (B2): results with fixed fixtures: subject score = sum of assessments, totals, averages, ranks 1, 2, 2, 4, incomplete students not ranked, both semesters and the year, promotion by pass mark and manual grades ("pending"), days absent per semester, a move keeping old results, over 100 refused (also two at once), G1, report card without GPA / letters, settings (audited), analytics score bands, scoping |
| g26 | Phase 2 M5a (B1): two semesters: migration 020 (semester 2 start = Yekatit 1 of the end date's Ethiopian year, every exam has a semester), exam date rules (inside the class's year, the date decides, a disagreeing semester 400, no date needs semester or term; term mapped), ?semester= filters, a changed semester 2 start moves dated exams (dry run first), raw inserts get a semester |
| g25 | Phase 2 M4: attendance report for a date range (`from`/`to`, at most 62 days; the older `month`/`year` still works): students × days grid, Monday–Friday plus weekend days with records, totals and rate, students who moved keep their rows; bad dates and ids 400/404 |
| g24 | Phase 2 M4: attendance marking rules (no future dates, inside the class's year, teacher: own classes of the current year, today and 3 days back; admin: any past date, audited), never 500 on bad input, class sheet (`marking`, Amharic names, empty class 200), admin correction with a reason (audited), rate = (present + late) / (marked − excused). Makes a test year containing today current while it runs (`todayyear.js`) and puts 2024/2025 back |
| g23 | Phase 2 M7a: safe promotion: preview (promote, repeat, graduate, missing classes; nothing written), apply refuses the same or an earlier year, missing classes, a changed list (confirm_count) and a second run (also three at once); one transaction, promotion_runs row, one audit entry; graduates lose their login; old records untouched |
| w1 | asms-web: type check, lint and unit tests (`npm test`: Vitest) |
| w2 | asms-web: browser tests (Playwright in Edge) of the built app on :5600 against this test backend: login and sessions, menus per role, Ethiopian date picker, admin account screens |

## Helpers and fixtures

| File | Purpose |
|---|---|
| `regress.sh`, `run.js` | Runner, and the npm entry point for it |
| `guard.sh`, `tdb.js` | Scratch-DB guard, and the guarded database pool |
| `srv.sh` | Start or stop the test server on :3100 |
| `static.js` | Serves `asms-frontend` on :5599, pointing `config.js` at :3100 |
| `cdp.js` | Minimal DevTools client for headless Edge (temporary profile, page-load checks) |
| `err500.js` | Sends a real database error through `sendServerError` for g3's generic-500 check |
| `token.js` | Signs an access token for a user (`node tests/token.js <email>`) |
| `mkstudents.js` | Creates throwaway students for g2b. The runner calls it |
| `g3fix.js` → `g3.json` | One-time fixture (teachers, students, parent, classes) used by g3, g4, g4b and g7–g12. `g3.json` holds the ids in the current scratch DB. Re-run `g3fix.js` and save its output to `g3.json` only for a fresh scratch DB |
| `fixture.js` | One-time fixture: the student with grades, payments and attendance used by g1, g4 and g6 |
| `examreset.js` | Removes the exams earlier runs left in the fixture classes 9A and 9B, so a run starts under the 100-point limit per subject and semester (D25). The runner calls it; the suites use small max scores there |
| `check_m5a.js` | The M5a rehearsal: 020 and 021 checks plus the empty 022 tables, for the three migrations in one run (`bash tests/restore_check.sh m5a tests/check_m5a.js`) |
| `check_023.js` | Dry run and before/after check for migration 023: subject codes and usage, timetable slots and their times, teacher double bookings, audit log size; afterwards subjects, timetable, audit log and settings unchanged, all subjects active, `period_times` seeded (`bash tests/restore_check.sh 023 tests/check_023.js`) |
| `check_021.js` | Dry run and before/after check for migration 021 (results): letters kept but no longer filled, the max-score check still refuses, settings seeded |
| `check_020.js` | Dry run and before/after check for migration 020 (semesters): exams per term and date, term/date disagreements, exams dated outside their year, term3 exams, subjects over 100 per semester (`bash tests/restore_check.sh 020 tests/check_020.js`) |
| `m4demo.js` | Scratch setup for trying the attendance screens by hand: the year around today current, class 5A with 4 students, teacher A assigned; `--restore` undoes it (run it before the suites) |
| `setpw.js` | Set a user's password in the scratch DB (`node tests/setpw.js <email> <password>`) |
| `fresh.js` | Optional: runs every migration in a temporary `fresh_install` schema, then drops it |
| `cleanup_uploads.js` | Optional: deletes files that tests uploaded under `uploads/documents` |
| `restore_check.sh`, `check_018.js` | Real-data check (PHASE2_PLAN D24): `bash tests/restore_check.sh 018 tests/check_018.js` dumps `asms` (read-only) to `C:\asms\asms_backup_before_018_<time>.dump`, restores it into `asms_restore_check`, runs the pending migrations there and checks before/after. Never writes to `asms`. Needs `asms_restore_check` to exist once: `createdb -U postgres -O asms_user asms_restore_check` |

Run one-time helpers through the guard, for example
`bash tests/guard.sh node tests/setpw.js admin@asms.et Admin@1234`.

## Browser suites

- Each browser suite starts Edge with a new, empty profile in the system temp
  folder (`asms-test-edge-*`) and deletes it when it finishes, even if the
  suite crashes. Edge may copy browsing data from your normal profile into a
  new profile at start, so nothing is kept between runs.
- `goto()` waits for the page's load event (up to 15 s; set
  `PAGE_LOAD_TIMEOUT` in ms to change it) and checks that the tab is on the
  test site. If a page doesn't load, the error names the URL, the reason (for
  example `net::ERR_CONNECTION_REFUSED`), what the tab is showing, and recent
  network and page errors.
- When a suite fails, the runner prints the last lines of its `.out` file.

## Notes

- The suites add data to the scratch DB (users, exams, payments). They are
  written to be re-run, but reset the scratch DB from a backup if it gets
  cluttered.
- g9 checks the teacher dashboard's timetable for today's weekday. On Sunday,
  which isn't a school day, it checks that today's list is empty instead.
