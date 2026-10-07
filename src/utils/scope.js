// src/utils/scope.js
// ============================================================
// What part of the school a user may see (docs/PERMISSIONS.md).
//
//   admin, principal → the whole school
//   teacher          → own classes (teacher_classes, any subject)
//   student          → own record / own class
//   parent           → linked children (student_parents) / their classes
//
// All ids are compared as text, so a malformed id simply matches nothing.
// ============================================================

const db = require('../config/db');

const SCHOOL_WIDE = ['admin', 'principal'];
const isSchoolWide = (user) => SCHOOL_WIDE.includes(user.role);

// Teacher profile id for a user, or null
const getTeacherId = async (userId) => {
  const { rows } = await db.query('SELECT id FROM teachers WHERE user_id = $1', [userId]);
  return rows[0]?.id || null;
};

/**
 * classScope — class ids the user may see, or null for "all classes".
 * Returns [] when the user may see no class at all.
 */
const classScope = async (user) => {
  if (isSchoolWide(user)) return null;

  let rows = [];
  if (user.role === 'teacher') {
    ({ rows } = await db.query(
      `SELECT DISTINCT tc.class_id AS id FROM teacher_classes tc
       JOIN teachers t ON t.id = tc.teacher_id
       WHERE t.user_id = $1`, [user.id]));
  } else if (user.role === 'student') {
    ({ rows } = await db.query(
      'SELECT class_id AS id FROM students WHERE user_id = $1 AND class_id IS NOT NULL', [user.id]));
  } else if (user.role === 'parent') {
    ({ rows } = await db.query(
      `SELECT DISTINCT s.class_id AS id FROM students s
       JOIN student_parents sp ON sp.student_id = s.id
       JOIN parents p ON p.id = sp.parent_id
       WHERE p.user_id = $1 AND s.class_id IS NOT NULL`, [user.id]));
  }
  return rows.map(r => r.id);
};

const canAccessClass = async (user, classId) => {
  const scope = await classScope(user);
  return scope === null || scope.includes(String(classId));
};

const canAccessStudent = async (user, studentId) => {
  if (isSchoolWide(user)) return true;
  const id = String(studentId);
  let rows = [];

  if (user.role === 'teacher') {
    ({ rows } = await db.query(
      `SELECT 1 FROM students s
       JOIN teacher_classes tc ON tc.class_id = s.class_id
       JOIN teachers t ON t.id = tc.teacher_id
       WHERE s.id::text = $1 AND t.user_id = $2 LIMIT 1`, [id, user.id]));
  } else if (user.role === 'student') {
    ({ rows } = await db.query(
      'SELECT 1 FROM students WHERE id::text = $1 AND user_id = $2', [id, user.id]));
  } else if (user.role === 'parent') {
    ({ rows } = await db.query(
      `SELECT 1 FROM student_parents sp
       JOIN parents p ON p.id = sp.parent_id
       WHERE sp.student_id::text = $1 AND p.user_id = $2`, [id, user.id]));
  }
  return rows.length > 0;
};

/**
 * scopeCondition — SQL fragment limiting `column` to the user's classes.
 * Pushes the class-id array onto params when needed. Returns null when
 * no limit applies (school-wide users).
 *   const cond = await scopeCondition(req.user, 'e.class_id', params);
 *   if (cond) conditions.push(cond);
 */
const scopeCondition = async (user, column, params) => {
  const scope = await classScope(user);
  if (scope === null) return null;
  params.push(scope);
  return `${column} = ANY($${params.length}::uuid[])`;
};

module.exports = {
  SCHOOL_WIDE, isSchoolWide, getTeacherId,
  classScope, canAccessClass, canAccessStudent, scopeCondition,
};
