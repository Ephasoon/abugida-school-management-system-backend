# ASMS Backlog

Items agreed but not yet scheduled. Newest first.

## Validate ids in request bodies like route ids

*Added 2026-10-14 · backend · not started*

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

*Added 2026-10-11 · backend · not started*

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
