// src/utils/attendance.js
// ============================================================
// Attendance rules shared by the controllers (M4, D28).
//   rate = (present + late) / (marked days - excused): late counts as attended,
//   excused days are left out; only 'absent' counts as days absent.
//   "today" is the server's local date (the school's time zone).
// ============================================================

const STATUSES = ['present', 'absent', 'late', 'excused'];
const TEACHER_WINDOW_DAYS = 3;   // a teacher marks or changes today and the previous 3 days

// SQL for the attendance rate in percent (1 decimal, NULL when nothing counts), over the
// rows of the query; `alias` is the attendance table alias, if any.
const rateSql = (alias = '') => {
  const s = alias ? `${alias}.status` : 'status';
  return `ROUND(COUNT(*) FILTER (WHERE ${s} IN ('present', 'late')) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE ${s} <> 'excused'), 0), 1)`;
};

// 'YYYY-MM-DD' that is a real calendar date
const isIsoDate = (d) =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 'YYYY-MM-DD' moved by n days
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The marking window for teachers: { today, earliest }
const teacherWindow = (today = localDate()) => ({ today, earliest: addDays(today, -TEACHER_WINDOW_DAYS) });

module.exports = { STATUSES, TEACHER_WINDOW_DAYS, rateSql, isIsoDate, localDate, addDays, teacherWindow };
