// src/middleware/validateIds.middleware.js
// ============================================================
// One check for id route parameters (:id, :studentId, :classId, ...):
//   malformed id (not a UUID)            → 404
//   valid UUID with no matching record   → 404
// so a bad id can never reach a uuid column and cause a 500.
//
// Place it last, right before the controller, so role checks and
// record-level access (studentAccess.middleware.js) still answer 403 first.
//
// Usage:
//   const checkIds = validateIds({ id: 'students' });   // what :id means on this router
//   router.get('/:id', allStaff, requireStudentAccess('id'), checkIds, getStudentById);
// Named params (studentId, classId, ...) map to their table automatically.
// ============================================================

const db                  = require('../config/db');
const { sendError }       = require('../utils/response');
const { sendServerError } = require('../utils/errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID.test(v);

// Table and label for each id kind
const TABLES = {
  academic_years: 'Academic year',
  attendance:     'Attendance record',
  classes:        'Class',
  documents:      'Document',
  exams:          'Exam',
  parents:        'Parent',
  students:       'Student',
  subjects:       'Subject',
  teachers:       'Teacher',
  timetable:      'Timetable slot',
  users:          'User',
};
const PARAM_TABLES = {
  classId:   'classes',
  examId:    'exams',
  parentId:  'parents',
  studentId: 'students',
  subjectId: 'subjects',
  teacherId: 'teachers',
  userId:    'users',
};
const isIdParam = (name) => name === 'id' || /Id$/.test(name);

/**
 * validateIds — checks every id route parameter for UUID format and existence.
 * @param {object} tables - extra/overriding param → table, e.g. { id: 'students' }
 */
const validateIds = (tables = {}) => {
  const map = { ...PARAM_TABLES, ...tables };
  for (const t of Object.values(map)) {
    if (!TABLES[t]) throw new Error(`validateIds: unknown table ${t}`);
  }
  return async (req, res, next) => {
    const names = Object.keys(req.params).filter(isIdParam);
    for (const name of names) {
      const table = map[name];
      if (!isUuid(req.params[name])) {
        return sendError(res, `${table ? TABLES[table] : 'Record'} not found (invalid id).`, 404);
      }
    }
    try {
      for (const name of names) {
        const table = map[name];
        if (!table) continue;
        const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [req.params[name]]);
        if (!rows.length) return sendError(res, `${TABLES[table]} not found.`, 404);
      }
    } catch (err) {
      return sendServerError(res, err, 'Server error while checking id.');
    }
    return next();
  };
};

module.exports = { validateIds, isUuid };
