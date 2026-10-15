// src/services/results.service.js
// ============================================================
// Results out of 100 (B2, PHASE2_PLAN §5.2): the one place that computes subject scores,
// totals, averages, ranks, yearly figures and promotion. Report cards, PDFs, class results,
// the parent portal and analytics all use it, so their numbers can't disagree.
//
// Per class, academic year (the class's) and semester:
//   subject score = sum of the student's scores on that subject's assessments (D15)
//   a subject is complete for a student when its max scores add up to exactly 100 and every
//   assessment has a score; over 100 is "over_100" (check) and never complete
//   total = sum of the subject scores; average = total / number of subjects
//   ranked: students complete in every subject that has an assessment (D16), by the average
//   rounded to 2 decimals, ties 1, 2, 2, 4
// Per year: yearly subject score = average of the semester scores (semesters where the subject
//   has assessments); yearly average = (semester 1 average + semester 2 average) / 2, only
//   when both semesters are ranked; yearly rank by it.
// Promotion (D17, D26): only for a ranked year and when pass_yearly_average is set; grades in
//   manual_promotion_grades are "pending" until the admin decides (a decision, from 022,
//   also overrides the pass mark for other grades).
// Students of a class = its active students now, plus anyone with a score in its exams
// (promotion and moves don't change old results). Days absent per semester: D28.
// ============================================================

const db = require('../config/db');

const SEMESTERS = ['semester1', 'semester2'];
// Score bands (D18), for analytics
const SCORE_BANDS = [
  { key: '90-100', min: 90, max: 100 },
  { key: '80-89', min: 80, max: 89.99 },
  { key: '70-79', min: 70, max: 79.99 },
  { key: '60-69', min: 60, max: 69.99 },
  { key: '50-59', min: 50, max: 59.99 },
  { key: 'below-50', min: 0, max: 49.99 },
];
const bandOf = (score) => SCORE_BANDS.find((b) => score >= b.min && score <= b.max + 0.0001)?.key ?? 'below-50';

class ResultsError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors; }
}

// Hundredths as integers, so sums and averages don't drift
const cents = (v) => Math.round(Number(v) * 100);
const fromCents = (c, decimals = 2) => Number((c / 100).toFixed(decimals));
const round1 = (v) => Math.round(v * 10) / 10;

/** Standard competition ranking (1, 2, 2, 4) of rows by key (higher first); sets row[field]. */
const rankBy = (rows, key, field) => {
  const sorted = [...rows].sort((a, b) => b[key] - a[key]);
  sorted.forEach((r, i) => { r[field] = i > 0 && sorted[i - 1][key] === r[key] ? sorted[i - 1][field] : i + 1; });
};

/** School settings the results need: { pass_yearly_average: number|null, manual_promotion_grades: number[] } */
const getSettings = async (q = db) => {
  const { rows } = await q.query("SELECT key, value FROM school_settings WHERE key IN ('pass_yearly_average', 'manual_promotion_grades')");
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const pass = typeof v.pass_yearly_average === 'number' ? v.pass_yearly_average : null;
  return { pass_yearly_average: pass, manual_promotion_grades: Array.isArray(v.manual_promotion_grades) ? v.manual_promotion_grades : [] };
};

const loadClass = async (q, classId) => (await q.query(
  `SELECT c.id, c.name, c.grade_level, c.section, c.academic_year_id, c.homeroom_teacher_id,
          y.name AS year_name, y.start_date, y.end_date, y.semester2_start, y.is_current
   FROM classes c JOIN academic_years y ON y.id = c.academic_year_id WHERE c.id::text = $1`,
  [String(classId).toLowerCase()])).rows[0] || null;

const semesterRange = (cls, semester) => (semester === 'semester1'
  ? { from: cls.start_date, to: addDays(cls.semester2_start, -1) }
  : { from: cls.semester2_start, to: cls.end_date });
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const STUDENT_COLUMNS = `s.id AS student_id, s.student_number, s.first_name, s.fathers_name, s.last_name,
  s.first_name_am, s.fathers_name_am, s.last_name_am, s.status AS student_status, (s.class_id = $1) AS in_class_now`;

/**
 * One class, one semester: subjects (with their assessments), and per student the subject
 * scores, total, average, completeness, rank and attendance.
 */
const classSemester = async (cls, semester, q = db) => {
  const { rows: subjects } = await q.query(
    `SELECT e.subject_id, s.name, s.name_am, SUM(e.max_score) AS max_total,
            json_agg(json_build_object('id', e.id, 'name', e.name, 'exam_type', e.exam_type,
              'max_score', e.max_score, 'exam_date', e.exam_date) ORDER BY e.exam_date NULLS LAST, e.created_at) AS exams
     FROM exams e JOIN subjects s ON s.id = e.subject_id
     WHERE e.class_id = $1 AND e.semester = $2
     GROUP BY e.subject_id, s.name, s.name_am ORDER BY s.name`, [cls.id, semester]);
  const { rows: roster } = await q.query(
    `SELECT ${STUDENT_COLUMNS} FROM students s
     WHERE (s.class_id = $1 AND s.status = 'active')
        OR EXISTS (SELECT 1 FROM grades g JOIN exams e ON e.id = g.exam_id WHERE g.student_id = s.id AND e.class_id = $1)
     ORDER BY s.first_name, s.last_name, s.student_number`, [cls.id]);
  const { rows: scores } = await q.query(
    `SELECT g.student_id, e.subject_id, SUM(g.score) AS score, COUNT(*)::int AS graded
     FROM grades g JOIN exams e ON e.id = g.exam_id
     WHERE e.class_id = $1 AND e.semester = $2 GROUP BY 1, 2`, [cls.id, semester]);
  const range = semesterRange(cls, semester);
  const { rows: att } = await q.query(
    `SELECT student_id, COUNT(*) FILTER (WHERE status = 'absent')::int AS absent,
            COUNT(*) FILTER (WHERE status = 'late')::int AS late, COUNT(*) FILTER (WHERE status = 'excused')::int AS excused
     FROM attendance WHERE class_id = $1 AND date BETWEEN $2 AND $3 GROUP BY 1`, [cls.id, range.from, range.to]);

  const subj = subjects.map((s) => {
    const max = Number(s.max_total);
    return {
      subject_id: s.subject_id, name: s.name, name_am: s.name_am, max_total: max,
      status: max === 100 ? 'ok' : max > 100 ? 'over_100' : 'incomplete',
      exams: s.exams.map((e) => ({ ...e, max_score: Number(e.max_score) })),
    };
  });
  const byKey = new Map(scores.map((r) => [`${r.student_id}/${r.subject_id}`, r]));
  const attBy = new Map(att.map((r) => [r.student_id, r]));

  const students = roster.map((st) => {
    let totalCents = 0;
    let complete = subj.length > 0;
    const perSubject = {};
    for (const s of subj) {
      const r = byKey.get(`${st.student_id}/${s.subject_id}`);
      const scoreCents = r ? cents(r.score) : 0;
      const graded = r ? r.graded : 0;
      const done = s.status === 'ok' && graded === s.exams.length;
      if (!done) complete = false;
      totalCents += scoreCents;
      perSubject[s.subject_id] = { score: r ? fromCents(scoreCents, 1) : null, graded, assessments: s.exams.length, complete: done };
    }
    const a = attBy.get(st.student_id) || { absent: 0, late: 0, excused: 0 };
    return {
      ...st,
      subjects: perSubject,
      total: subj.length ? fromCents(totalCents, 1) : null,
      average: subj.length ? fromCents(Math.round(totalCents / subj.length), 2) : null,
      complete,
      rank: null,
      days_absent: a.absent, days_late: a.late, days_excused: a.excused,
    };
  });
  const ranked = students.filter((s) => s.complete);
  ranked.forEach((s) => { s._key = Math.round(s.average * 100); });
  rankBy(ranked, '_key', 'rank');
  ranked.forEach((s) => { delete s._key; });

  return {
    semester, range, subjects: subj, students,
    class_size: students.length, ranked_count: ranked.length,
  };
};

/** Promotion for a yearly result: { status: 'promoted'|'not_promoted'|'pending', basis } or null. */
const promotionFor = (cls, row, settings, decision) => {
  if (decision) return { status: decision.promoted ? 'promoted' : 'not_promoted', basis: 'decision', note: decision.note ?? null, decided_at: decision.decided_at ?? null };
  if (settings.pass_yearly_average === null || row.yearly_rank === null) return null;
  if (settings.manual_promotion_grades.includes(cls.grade_level)) return { status: 'pending', basis: 'manual' };
  return { status: row.yearly_average >= settings.pass_yearly_average ? 'promoted' : 'not_promoted', basis: 'pass_mark', pass_mark: settings.pass_yearly_average };
};

// Manual promotion decisions of a year (table from migration 022; none before it)
const loadDecisions = async (q, yearId) => {
  const exists = (await q.query("SELECT to_regclass('public.promotion_decisions') IS NOT NULL AS e")).rows[0].e;
  if (!exists) return new Map();
  const { rows } = await q.query('SELECT student_id, promoted, note, decided_at FROM promotion_decisions WHERE academic_year_id = $1', [yearId]);
  return new Map(rows.map((r) => [r.student_id, r]));
};

/** One class, the whole year: both semesters, yearly figures, yearly rank, promotion. */
const classYear = async (cls, q = db) => {
  const [s1, s2] = [await classSemester(cls, 'semester1', q), await classSemester(cls, 'semester2', q)];
  const settings = await getSettings(q);
  const decisions = await loadDecisions(q, cls.academic_year_id);
  const subjectIds = [...new Set([...s1.subjects, ...s2.subjects].map((s) => s.subject_id))];
  const subjects = subjectIds.map((id) => {
    const a = s1.subjects.find((s) => s.subject_id === id), b = s2.subjects.find((s) => s.subject_id === id);
    return { subject_id: id, name: (a || b).name, name_am: (a || b).name_am, semesters: [a && 'semester1', b && 'semester2'].filter(Boolean) };
  }).sort((x, y) => x.name.localeCompare(y.name));
  const ids = [...new Set([...s1.students, ...s2.students].map((s) => s.student_id))];
  const students = ids.map((id) => {
    const a = s1.students.find((s) => s.student_id === id), b = s2.students.find((s) => s.student_id === id);
    const base = a || b;
    const yearly = {};
    for (const sub of subjects) {
      const vals = sub.semesters.map((sem) => (sem === 'semester1' ? a : b)?.subjects[sub.subject_id]?.score).filter((v) => v !== null && v !== undefined);
      yearly[sub.subject_id] = vals.length === sub.semesters.length ? round1(vals.reduce((t, v) => t + v, 0) / vals.length) : null;
    }
    const bothRanked = !!(a?.rank && b?.rank);
    return {
      student_id: id, student_number: base.student_number, first_name: base.first_name, fathers_name: base.fathers_name,
      last_name: base.last_name, first_name_am: base.first_name_am, fathers_name_am: base.fathers_name_am, last_name_am: base.last_name_am,
      student_status: base.student_status, in_class_now: base.in_class_now,
      semester1: a ? { average: a.average, rank: a.rank, complete: a.complete } : null,
      semester2: b ? { average: b.average, rank: b.rank, complete: b.complete } : null,
      yearly_subjects: yearly,
      yearly_average: bothRanked ? fromCents(Math.round((cents(a.average) + cents(b.average)) / 2), 2) : null,
      yearly_rank: null,
      days_absent: (a?.days_absent ?? 0) + (b?.days_absent ?? 0),
    };
  });
  const ranked = students.filter((s) => s.yearly_average !== null);
  ranked.forEach((s) => { s._key = Math.round(s.yearly_average * 100); });
  rankBy(ranked, '_key', 'yearly_rank');
  ranked.forEach((s) => { delete s._key; });
  for (const s of students) s.promotion = promotionFor(cls, s, settings, decisions.get(s.student_id));
  students.sort((x, y) => x.first_name.localeCompare(y.first_name) || x.last_name.localeCompare(y.last_name));
  return { semesters: { semester1: s1, semester2: s2 }, subjects, students, class_size: students.length, ranked_count: ranked.length, settings };
};

const classInfo = (cls) => ({
  id: cls.id, name: cls.name, grade_level: cls.grade_level, section: cls.section, homeroom_teacher_id: cls.homeroom_teacher_id,
});
const yearInfo = (cls) => ({
  id: cls.academic_year_id, name: cls.year_name, start_date: cls.start_date, end_date: cls.end_date,
  semester2_start: cls.semester2_start, is_current: cls.is_current,
});

/** GET /results/class/:classId?semester=1|2|year */
const classResults = async (classId, semester, q = db) => {
  const cls = await loadClass(q, classId);
  if (!cls) throw new ResultsError(404, 'Class not found.');
  if (semester === 'year') {
    const y = await classYear(cls, q);
    return { class: classInfo(cls), academic_year: yearInfo(cls), semester: 'year', ...y };
  }
  const r = await classSemester(cls, semester, q);
  return { class: classInfo(cls), academic_year: yearInfo(cls), ...r };
};

/**
 * GET /results/student/:studentId?academic_year_id=
 * The year: as asked, else that of the student's class, else the latest year with scores.
 * The class: the student's class if in that year, else the class with most of their scores.
 */
const studentResults = async (studentId, academicYearId, q = db) => {
  const { rows: st } = await q.query(
    `SELECT s.id, s.student_number, s.first_name, s.fathers_name, s.last_name, s.first_name_am, s.fathers_name_am,
            s.last_name_am, s.status, s.class_id, c.academic_year_id AS current_year_id
     FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id::text = $1`, [String(studentId).toLowerCase()]);
  if (!st[0]) throw new ResultsError(404, 'Student not found.');
  const student = st[0];
  let yearId = academicYearId;
  if (!yearId) {
    yearId = student.current_year_id || (await q.query(
      `SELECT c.academic_year_id FROM grades g JOIN exams e ON e.id = g.exam_id JOIN classes c ON c.id = e.class_id
       JOIN academic_years y ON y.id = c.academic_year_id WHERE g.student_id = $1 ORDER BY y.start_date DESC LIMIT 1`, [student.id])).rows[0]?.academic_year_id;
  }
  if (!yearId) throw new ResultsError(404, 'This student has no class and no results.');
  let classId = student.current_year_id === yearId ? student.class_id : null;
  if (!classId) {
    classId = (await q.query(
      `SELECT e.class_id FROM grades g JOIN exams e ON e.id = g.exam_id JOIN classes c ON c.id = e.class_id
       WHERE g.student_id = $1 AND c.academic_year_id::text = $2 GROUP BY e.class_id ORDER BY COUNT(*) DESC LIMIT 1`,
      [student.id, String(yearId)])).rows[0]?.class_id;
  }
  if (!classId) throw new ResultsError(404, 'This student has no class or results in that academic year.');
  const cls = await loadClass(q, classId);
  const y = await classYear(cls, q);
  const semester = (key) => {
    const sem = y.semesters[key];
    const row = sem.students.find((s) => s.student_id === student.id);
    return {
      semester: key, range: sem.range, class_size: sem.class_size, ranked_count: sem.ranked_count,
      subjects: sem.subjects.map((s) => ({
        subject_id: s.subject_id, name: s.name, name_am: s.name_am, max_total: s.max_total, status: s.status,
        assessments: s.exams.length, ...(row?.subjects[s.subject_id] ?? { score: null, graded: 0, complete: false }),
      })),
      total: row?.total ?? null, average: row?.average ?? null, complete: row?.complete ?? false, rank: row?.rank ?? null,
      days_absent: row?.days_absent ?? 0, days_late: row?.days_late ?? 0, days_excused: row?.days_excused ?? 0,
    };
  };
  const yrow = y.students.find((s) => s.student_id === student.id);
  return {
    student: { id: student.id, student_number: student.student_number, first_name: student.first_name, fathers_name: student.fathers_name,
      last_name: student.last_name, first_name_am: student.first_name_am, fathers_name_am: student.fathers_name_am,
      last_name_am: student.last_name_am, status: student.status },
    class: classInfo(cls),
    academic_year: yearInfo(cls),
    semesters: { semester1: semester('semester1'), semester2: semester('semester2') },
    year: {
      subjects: y.subjects.map((s) => ({ subject_id: s.subject_id, name: s.name, name_am: s.name_am, score: yrow?.yearly_subjects[s.subject_id] ?? null })),
      average: yrow?.yearly_average ?? null, rank: yrow?.yearly_rank ?? null,
      class_size: y.class_size, ranked_count: y.ranked_count, days_absent: yrow?.days_absent ?? 0,
      promotion: yrow?.promotion ?? null,
    },
    settings: { pass_yearly_average: y.settings.pass_yearly_average },
  };
};

module.exports = {
  SEMESTERS, SCORE_BANDS, bandOf, ResultsError, getSettings, loadClass, classSemester, classYear,
  classResults, studentResults, rankBy,
};
