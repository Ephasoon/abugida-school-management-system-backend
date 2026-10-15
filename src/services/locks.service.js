// src/services/locks.service.js
// ============================================================
// Semester locks (D29, migration 022). A lock (one class, or the whole school when class_id
// is NULL) makes its semester's results final: every write that would change them is refused
// with 409 until the admin unlocks it:
//   scores (POST /grades), exams (create, edit, cancel), conduct, manual promotion decisions
//   (semester 2, the year's end), attendance marked or corrected inside the semester's dates,
//   and a changed semester2_start (either semester).
// Call the asserts inside the write's transaction where there is one.
// ============================================================

const { academicYearEthiopian } = require('../utils/ethiopianDate');
const { semesterNumber } = require('../utils/semesters');

class LockedError extends Error {
  constructor(message, lock) { super(message); this.status = 409; this.errors = { code: 'semester_locked', lock_id: lock.id }; }
}

// The lock covering this class's semester (a whole-school lock first), or null
const findLock = async (q, { yearId, semester, classId }) => (await q.query(
  `SELECT l.id, l.semester, l.class_id, l.reason, l.locked_at, c.name AS class_name, y.name AS year_name, y.end_date
   FROM semester_locks l JOIN academic_years y ON y.id = l.academic_year_id
   LEFT JOIN classes c ON c.id = l.class_id
   WHERE l.academic_year_id = $1 AND l.semester = $2 AND (l.class_id IS NULL OR l.class_id = $3)
   ORDER BY l.class_id NULLS FIRST LIMIT 1`, [yearId, semester, classId ?? null])).rows[0] || null;

const lockMessage = (lock, className) =>
  `Semester ${semesterNumber(lock.semester)} ${academicYearEthiopian(lock.end_date)} E.C. is locked for ${lock.class_id ? lock.class_name : className ? `the whole school (${className})` : 'the whole school'}. Ask the admin to unlock it.`;

/** Throws LockedError (409) when the class's semester is locked. */
const assertSemesterUnlocked = async (q, { classId, yearId, semester, className }) => {
  const lock = await findLock(q, { yearId, semester, classId });
  if (lock) throw new LockedError(lockMessage(lock, className), lock);
};

/** The class's year and the semester of a date in it; throws when that semester is locked. */
const assertDateUnlocked = async (q, classId, date) => {
  const { rows } = await q.query(
    `SELECT c.name, c.academic_year_id, y.semester2_start, y.start_date, y.end_date
     FROM classes c JOIN academic_years y ON y.id = c.academic_year_id WHERE c.id = $1`, [classId]);
  const c = rows[0];
  if (!c || date < c.start_date || date > c.end_date) return;
  const semester = date >= c.semester2_start ? 'semester2' : 'semester1';
  await assertSemesterUnlocked(q, { classId, yearId: c.academic_year_id, semester, className: c.name });
};

/** Throws when any semester of the year is locked (for changes that move both, like semester2_start). */
const assertYearUnlocked = async (q, yearId) => {
  const { rows } = await q.query(
    `SELECT l.id, l.semester, l.class_id, c.name AS class_name, y.end_date FROM semester_locks l
     JOIN academic_years y ON y.id = l.academic_year_id LEFT JOIN classes c ON c.id = l.class_id
     WHERE l.academic_year_id = $1 ORDER BY l.class_id NULLS FIRST LIMIT 1`, [yearId]);
  if (rows[0]) throw new LockedError(`${lockMessage(rows[0])} Changing when semester 2 starts would move its exams.`, rows[0]);
};

/** Lock state of a class's two semesters: { semester1: lock|null, semester2: lock|null } */
const classLocks = async (q, cls) => ({
  semester1: await findLock(q, { yearId: cls.academic_year_id, semester: 'semester1', classId: cls.id }),
  semester2: await findLock(q, { yearId: cls.academic_year_id, semester: 'semester2', classId: cls.id }),
});

module.exports = { LockedError, findLock, assertSemesterUnlocked, assertDateUnlocked, assertYearUnlocked, classLocks };
