# ASMS Backlog

Items agreed but not yet scheduled. Newest first.

## Reports page

*Added 2026-10-24 · asms-web · not started (M10: the old analytics.html is not rebuilt)*

A reports page for admin and principal, on the existing `/api/analytics/*` endpoints (kept in
M10): enrolment, attendance trends, most absent students, subject averages, finance by month.

## Print styles for more screens

*Added 2026-10-24 · asms-web · not started*

Print styles (`src/styles/print.css`, as the receipt, result sheet, timetable, attendance
report, outstanding list and payment history have) for: the report card view, the student list,
the class list, the student profile and the documents list. Until then the browser prints the
screen as it is (sidebar included).

## Flaky tests

*Added 2026-10-24 · backend tests · partly done (M10)*

- g22: audit entry order ("create and edits audited" saw class.updated before class.created).
  Still open.
- Done in M10: g5, g5b and g6 (old frontend, including "showTab is not defined" and the Google
  Fonts timeouts) were retired with the old frontend; g9's browser check was removed.

## Parents see shared documents of their own children

*Added 2026-10-24 · backend + asms-web · not started (M9: parents and students see no documents)*

On the parent portal, the shared (not private) documents of the parent's own children, read-only
with download, e.g. a report card or a national exam result. Private documents stay staff-only.

## Teacher documents tab

*Added 2026-10-24 · asms-web · not started*

A Documents tab on the teacher profile for documents linked to the teacher (`documents.teacher_id`,
e.g. contracts, certificates), with upload pre-linked to the teacher. The backend already accepts
`teacher_id` on upload and as a list filter; no document uses it yet.

## Outstanding report for a past year: group by the class in that year

*Added 2026-10-24 · backend · not started*

The outstanding report for a past year should group students by their class in that year
(from the charges' year), not their current class. E.g. Dawit Tadesse shows under Grade 9A
in the 2024/2025 report; he was in 8A. `GET /finance/outstanding` joins `students.class_id`
today.

## Late fees

*Added 2026-10-24 · backend + asms-web · not started (M8 decision: no late fees for now)*

A late fee on charges still open some days after their due date (amount or percentage, per
fee structure, with a grace period), added as its own charge so it can be waived. M8 only
shows overdue charges (due date passed, balance > 0).

## Automatic sibling discounts

*Added 2026-10-24 · backend + asms-web · not started (D22: manual for now)*

Apply a sibling discount automatically to brothers and sisters (students sharing a parent),
e.g. 10% from the second child, instead of the admin entering each one. M8 discounts are
entered manually per student and fee, with the reason "sibling".

## Ethiopian local time in Amharic mode

*Added 2026-10-24 · asms-web · not started*

Show times in Ethiopian local time in Amharic mode, next to the usual time, e.g.
**8:00 (2:00 ጠዋት)**: the Ethiopian day starts at 6:00, so local hour = hour − 6
(12-hour, with ጠዋት / ከሰዓት / ማታ / ሌሊት). Everywhere a time is shown: timetable, exam
times, the period times setting, the audit log. Times stay stored and entered as today.

## School holidays list (incl. movable Ethiopian holidays)

M4 has no holiday list (D31): unmarked days do not count, so rates are right, but the
monthly report shows a holiday on a weekday as "not marked". Add an admin-managed list of
school holidays per academic year, including the movable Ethiopian holidays (Fasika,
Siklet, Eid al-Fitr, Eid al-Adha, Mawlid), and grey those days out in the report.

## Validate ids in request bodies like route ids

*Added 2026-10-14 · backend · **done 2026-10-14** (M3, `feat/g10-body-ids`)*

**Done:** `src/middleware/validateBodyIds.middleware.js`, one check on every
write route that takes ids in the body (after the role and record-level
checks): `validateBodyIds({ class_id: 'classes', 'records[].student_id': 'students' })`.
Malformed and unknown ids answer 400 `"<field> does not exist."` with
`errors.field`; array entries are named (`subject_ids[1]`,
`grades[2].student_id`). Missing ids are left to the route's own "required"
check. A refused upload's file is deleted. Suite g17. The duplicate checks
in `assignClass` / `assignSubjects` were removed. Also fixed on the way: a
refused upload file type answered 500 (multer filter error), now 400 (413
over 10 MB).

Before the change (g17 with `AUDIT=1` on `main`), malformed / unknown:

| Route, field | malformed | unknown |
|---|---|---|
| POST /academic-years/:id/promote from_year_id | 500 | 404 |
| POST /accounts/parents/:id/children student_id | 404 | 404 |
| POST /attendance class_id, records[].student_id | 500 | 500 |
| POST /documents/upload student_id, teacher_id | 500 | 500 |
| POST /exam-schedule, POST /grades/exams class_id, subject_id | 404 | 404 |
| POST /grades exam_id | 500 | 404 |
| POST /grades grades[].student_id | 500 | 500 |
| POST /finance/payments student_id, fee_structure_id | 500 | 500 |
| POST /students class_id | 500 | 400 |
| PUT /students/:id class_id | 500 | 500 |
| POST /teachers/:id/subjects, /classes | 400 | 400 |
| POST /timetable, PUT /timetable/:id class_id, subject_id, teacher_id | 500 | 500 |


**Why:** `fix/malformed-ids` (PR #7, merged) added
`src/middleware/validateIds.middleware.js`. It answers 404 for malformed or
unknown ids in **route params**. Ids in **request bodies** are not checked, so
they can still reach a uuid column or a foreign key and cause a 500, the same
problem as `GET /api/students/not-a-uuid`.

**Scope:**
- Audit every route that reads an id from the body: `class_id`, `student_id`,
  `subject_id`, `teacher_id`, `exam_id`, `from_year_id`, `subject_ids[]`,
  `grades[].student_id`, `records[].student_id`, etc. For each one, record
  what a malformed id and a valid-but-unknown id return today.
- Validate them with one shared check: reuse `isUuid` and the table map from
  `validateIds`. Don't write a separate check in each controller. Never 500.

**Decision (2026-10-14): body ids answer 400 and name the field.**
- A malformed or unknown body id answers **400** (bad input, not 404: the
  URL itself is valid). The message names the field, e.g.
  `"class_id does not exist"`. Use the same message for malformed and unknown.
- For ids inside arrays, name the field and say which entry is wrong, for
  example `grades[2].student_id`. Or list the bad ids in `errors`, as
  `enterGrades` already does for students outside the exam's class.
- Route ids keep their current behaviour: 404 for malformed or unknown.
- Keep role and record-level 403s first, as `validateIds` does.
- Overlaps with "assignClass: validate input" below (`class_id` /
  `subject_id` in `POST /api/teachers/:id/classes`).
- Add a test suite like g13 (malformed and unknown body ids on every
  audited route).

**Test on:** `asms_phase0_test`.

## g3: make "teacher A student docs" a real assertion

*Added 2026-10-14 · tests · not started*

**Why:** in `tests/g3.sh`, the `titles()` helper reads
`(r.data.documents||r.data)`. `GET /api/documents/student/:id` now returns
`{ total, by_category: { <category>: [...] } }`, so the "teacher A student
docs" line prints empty. It is only an `echo`, so no test fails.

**Scope:**
- Make `titles()` (or a separate helper for this endpoint) read the
  `by_category` shape.
- Turn the line into an `ok` assertion. Teacher A should see their own
  private documents and the public ones for S1, and not teacher B's private
  documents.
- Check the other `titles` lines (teacher A, teacher B and admin lists) still
  read their endpoints' current shapes.

**Test on:** `asms_phase0_test`.

## assignClass: validate input and write an audit log entry

*Added 2026-10-11 · backend · **done 2026-10-14** (branch `feat/assign-class-audit`, suite g15)*

**Done:** active teacher (400 if deactivated, 404 if unknown), `class_id` /
`subject_id` must exist: **400 naming the field** (`"class_id does not exist."`),
following the later body-id decision above rather than the 404 first written
here. Duplicates answer 409, also when sent at the same moment (the insert
itself decides). Subjects outside the teacher's list are saved, and the
response has `outside_subject_list: true`. Audit entries
`teacher.class_assigned` and `teacher.class_unassigned` (target `teacher`,
`new_data` with `class_id`, `subject_id`) are written in the same transaction
as the change.

**Why:** `POST /api/teachers/:id/classes` (`assignClass` in
`src/controllers/teacher.controller.js`) only checks that `class_id` and
`subject_id` are present, then runs `INSERT … ON CONFLICT DO NOTHING`. It does
not check that the teacher, class or subject exist (a bad id surfaces as a 500
from the foreign key), reports success for a duplicate, and leaves no trace of
who assigned whom. Found while fixing soonepha@gmail.com's missing assignment
(the Grade 12 Section B / Physics row added on 2026-10-11 has no audit entry).

**Scope:**
- Teacher exists and is active (`teachers.is_active`) → otherwise 404 / 400.
- Class exists → otherwise 404.
- Subject exists → otherwise 404.
- No duplicate (same teacher, class, subject) → 409 with a clear message
  instead of a silent success.
- Malformed ids answer 404, not 500 (compare as `::text`, as
  `removeClassAssignment` already does).
- Write an audit log entry the same way the account actions do (the `audit()`
  helper in `src/controllers/accounts.controller.js`), e.g.
  `teacher.class_assigned`, target `teacher`, `new_data` with `class_id` and
  `subject_id`. Do the insert and the audit entry in one transaction.
- Consider the same audit entry for `removeClassAssignment`
  (`teacher.class_unassigned`).

**Decision (2026-10-11): subjects outside the teacher's list are allowed.**
- Backend: do **not** reject a subject missing from the teacher's
  `teacher_subjects`; the assignment is saved as usual.
- Frontend (`teacher-assignments.html`): when the chosen subject is not in the
  teacher's subject list, show a warning (e.g. "Biniyam Samuel does not teach
  Mathematics. Assign anyway?") and only send the request after the admin
  confirms. Subjects in the list assign without a prompt.
  `GET /api/teachers` already returns each teacher's `subjects` (names), so
  this needs no extra request.

**Test on:** `asms_phase0_test`.
