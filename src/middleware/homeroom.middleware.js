// src/middleware/homeroom.middleware.js
// ============================================================
// The homeroom teacher of a class (classes.homeroom_teacher_id) may enter that class's
// conduct grades and remarks (D23), and nothing else (docs/PERMISSIONS.md).
//   requireHomeroom(param)        — write: admin, or the class's homeroom teacher
//   requireHomeroomOrClass(param) — read: admin, principal, the homeroom teacher, or a
//                                   teacher of the class (teacher_classes)
// A malformed or unknown class id matches nothing (403 for teachers; validateIds gives
// admins the 404 afterwards).
// ============================================================

const db = require('../config/db');
const { sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');

const isHomeroom = async (userId, classId) => (await db.query(
  `SELECT 1 FROM classes c JOIN teachers t ON t.id = c.homeroom_teacher_id
   WHERE c.id::text = $1 AND t.user_id = $2`, [String(classId).toLowerCase(), userId])).rows.length > 0;

const teachesClass = async (userId, classId) => (await db.query(
  `SELECT 1 FROM teacher_classes tc JOIN teachers t ON t.id = tc.teacher_id
   WHERE tc.class_id::text = $1 AND t.user_id = $2 LIMIT 1`, [String(classId).toLowerCase(), userId])).rows.length > 0;

const guard = (check, message) => async (req, res, next) => {
  try {
    if (await check(req)) return next();
    return sendError(res, message, 403);
  } catch (err) {
    return sendServerError(res, err, 'Server error while checking access.');
  }
};

const requireHomeroom = (param = 'classId') => guard(
  (req) => req.user.role === 'admin' || (req.user.role === 'teacher' && isHomeroom(req.user.id, req.params[param])),
  'Only the homeroom teacher of this class and the administrator enter conduct and remarks.');

const requireHomeroomOrClass = (param = 'classId') => guard(async (req) => {
  if (['admin', 'principal'].includes(req.user.role)) return true;
  if (req.user.role !== 'teacher') return false;
  return (await isHomeroom(req.user.id, req.params[param])) || teachesClass(req.user.id, req.params[param]);
}, 'Access denied. You can only access your own classes.');

module.exports = { requireHomeroom, requireHomeroomOrClass, isHomeroom };
