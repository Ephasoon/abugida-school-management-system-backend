// src/services/promotion.service.js
// ============================================================
// Safe promotion (M7a): move the active students of one academic year's
// classes into the next year's classes.
//   promote  → grade + 1, same section, in the target year
//   repeat   → the same grade and section in the target year (the admin
//              excluded the student; pass/fail from results comes in M5)
//   graduate → grade 12 (status 'graduated', login disabled)
// The target classes must already exist (copy classes first); nothing is
// created here. buildPlan is used by the preview (read-only) and by apply,
// which runs it again inside its transaction.
// ============================================================

const TOP_GRADE = 12;

class PromotionError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}

const loadYears = async (q, toYearId, fromYearId) => {
  const { rows } = await q.query(
    `SELECT id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, is_current
     FROM academic_years WHERE id = ANY($1::uuid[])`, [[toYearId, fromYearId]]);
  const to = rows.find((y) => y.id === toYearId.toLowerCase());
  const from = rows.find((y) => y.id === fromYearId.toLowerCase());
  if (!to || !from) throw new PromotionError(404, 'Academic year not found.');
  if (to.id === from.id) throw new PromotionError(400, 'from_year_id must be the previous academic year, not this one.');
  if (to.start_date <= from.start_date) {
    throw new PromotionError(400, `${to.name} must start after ${from.name}: students are promoted into a later year.`);
  }
  return { to, from };
};

/**
 * The promotion plan: one row per active student in a class of the source
 * year. exclude: student ids who repeat the grade. lock: FOR UPDATE (apply).
 */
const buildPlan = async (q, toYearId, fromYearId, exclude = [], { lock = false } = {}) => {
  const { to, from } = await loadYears(q, toYearId, fromYearId);
  const excluded = new Set(exclude.map((x) => String(x).toLowerCase()));

  const { rows: students } = await q.query(
    `SELECT s.id, s.student_number, s.first_name, s.last_name, s.fathers_name,
            s.first_name_am, s.fathers_name_am, s.last_name_am, s.user_id,
            c.id AS class_id, c.name AS class_name, c.grade_level, c.section
     FROM students s JOIN classes c ON c.id = s.class_id
     WHERE c.academic_year_id = $1 AND s.status = 'active'
     ORDER BY c.grade_level, c.section, s.first_name, s.last_name
     ${lock ? 'FOR UPDATE OF s' : ''}`, [from.id]);
  const notInYear = [...excluded].filter((id) => !students.some((s) => s.id === id));
  if (notInYear.length) {
    throw new PromotionError(400, `exclude: ${notInYear.length} student(s) are not active students of ${from.name}.`, { not_in_year: notInYear });
  }

  const { rows: targets } = await q.query(
    'SELECT id, name, grade_level, section FROM classes WHERE academic_year_id = $1', [to.id]);
  const target = (grade, section) => targets.find((c) => c.grade_level === grade && c.section === section) || null;

  const rows = students.map((s) => {
    const repeat = excluded.has(s.id);
    const action = repeat ? 'repeat' : s.grade_level >= TOP_GRADE ? 'graduate' : 'promote';
    const wanted = action === 'graduate' ? null : { grade_level: repeat ? s.grade_level : s.grade_level + 1, section: s.section };
    const to_class = wanted && target(wanted.grade_level, wanted.section);
    return {
      student: {
        id: s.id, student_number: s.student_number, first_name: s.first_name, last_name: s.last_name, fathers_name: s.fathers_name,
        first_name_am: s.first_name_am, fathers_name_am: s.fathers_name_am, last_name_am: s.last_name_am,
      },
      user_id: s.user_id,
      from_class: { id: s.class_id, name: s.class_name, grade_level: s.grade_level, section: s.section },
      action,
      to_class: to_class ? { id: to_class.id, name: to_class.name, grade_level: to_class.grade_level, section: to_class.section } : null,
      problem: wanted && !to_class ? 'missing_class' : null,
      wanted,
    };
  });

  // Target classes that don't exist yet, with how many students need them
  const missing = new Map();
  for (const r of rows.filter((x) => x.problem)) {
    const k = `${r.wanted.grade_level}${r.wanted.section}`;
    missing.set(k, { ...r.wanted, students: (missing.get(k)?.students ?? 0) + 1 });
  }
  const count = (a) => rows.filter((r) => r.action === a).length;
  return {
    from_year: from, to_year: to, rows,
    missing_classes: [...missing.values()].sort((a, b) => a.grade_level - b.grade_level || a.section.localeCompare(b.section)),
    totals: { total: rows.length, promote: count('promote'), repeat: count('repeat'), graduate: count('graduate'), problems: rows.filter((r) => r.problem).length },
  };
};

/** Active students without a class: not moved by a promotion (shown in the preview). */
const studentsWithoutClass = async (q) => (await q.query(
  `SELECT id, student_number, first_name, last_name, first_name_am, last_name_am
   FROM students WHERE class_id IS NULL AND status = 'active' ORDER BY first_name, last_name LIMIT 200`)).rows;

const runFor = async (q, fromYearId) => (await q.query(
  `SELECT pr.id, pr.from_year_id, pr.to_year_id, pr.run_at, pr.promoted, pr.repeated, pr.graduated,
          fy.name AS from_year, ty.name AS to_year, u.email AS run_by_email
   FROM promotion_runs pr
   JOIN academic_years fy ON fy.id = pr.from_year_id
   JOIN academic_years ty ON ty.id = pr.to_year_id
   LEFT JOIN users u ON u.id = pr.run_by
   WHERE pr.from_year_id = $1`, [fromYearId])).rows[0] || null;

module.exports = { buildPlan, studentsWithoutClass, runFor, PromotionError, TOP_GRADE };
