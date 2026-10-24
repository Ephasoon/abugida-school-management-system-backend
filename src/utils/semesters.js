// src/utils/semesters.js
// ============================================================
// Two semesters per academic year (B1, PHASE2_PLAN §5.1, migration 020).
//   semester 1 = start_date … the day before semester2_start
//   semester 2 = semester2_start … end_date
// The API takes semester as 1 | 2 (or 'semester1' | 'semester2'). The old `term`
// (mapped until M10) is refused with a 400 that names semester.
// ============================================================

const SEMESTERS = ['semester1', 'semester2'];
const TERM_GONE = 'term is no longer accepted (since M10): use semester 1 or 2.';

/** 1 | 2 | '1' | 'semester1' … -> 'semester1' | 'semester2'; undefined when absent; null when invalid. */
const parseSemester = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'semester1') return 'semester1';
  if (s === '2' || s === 'semester2') return 'semester2';
  return null;
};

/** The semester of a date inside a year { start_date, end_date, semester2_start }, or null outside it. */
const semesterOfDate = (year, date) => {
  if (!date || date < year.start_date || date > year.end_date) return null;
  return date >= year.semester2_start ? 'semester2' : 'semester1';
};

/**
 * A read filter from ?semester= (the old ?term= is refused).
 * Returns { semester } (undefined: no filter) or { error }.
 */
const semesterFilter = (query = {}) => {
  if (query.semester !== undefined) {
    const semester = parseSemester(query.semester);
    return semester === null ? { error: 'semester must be 1 or 2.' } : { semester };
  }
  if (query.term !== undefined && query.term !== '') return { error: TERM_GONE };
  return { semester: undefined };
};

const semesterNumber = (s) => (s === 'semester2' ? 2 : 1);

module.exports = { SEMESTERS, TERM_GONE, parseSemester, semesterOfDate, semesterFilter, semesterNumber };
