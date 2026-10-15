// src/utils/semesters.js
// ============================================================
// Two semesters per academic year (B1, PHASE2_PLAN §5.1, migration 020).
//   semester 1 = start_date … the day before semester2_start
//   semester 2 = semester2_start … end_date
// The API takes semester as 1 | 2 (or 'semester1' | 'semester2'). Until the old
// frontend is retired (M10) `term` is still accepted and mapped: term1 -> 1,
// term2 / term3 -> 2; new exams also store the matching term so its pages
// keep showing it.
// ============================================================

const SEMESTERS = ['semester1', 'semester2'];
const TERMS = ['term1', 'term2', 'term3'];
const TERM_TO_SEMESTER = { term1: 'semester1', term2: 'semester2', term3: 'semester2' };
const SEMESTER_TO_TERM = { semester1: 'term1', semester2: 'term2' };

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
 * A read filter from ?semester= (or the old ?term=, mapped).
 * Returns { semester } (undefined: no filter) or { error }.
 */
const semesterFilter = (query = {}) => {
  if (query.semester !== undefined) {
    const semester = parseSemester(query.semester);
    return semester === null ? { error: 'semester must be 1 or 2.' } : { semester };
  }
  if (query.term !== undefined && query.term !== '') {
    if (!TERMS.includes(query.term)) return { error: `term must be one of: ${TERMS.join(', ')} (or use semester=1|2).` };
    return { semester: TERM_TO_SEMESTER[query.term] };
  }
  return { semester: undefined };
};

const semesterNumber = (s) => (s === 'semester2' ? 2 : 1);

module.exports = { SEMESTERS, TERMS, TERM_TO_SEMESTER, SEMESTER_TO_TERM, parseSemester, semesterOfDate, semesterFilter, semesterNumber };
