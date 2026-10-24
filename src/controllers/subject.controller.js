// src/controllers/subject.controller.js
// ============================================================
// Subjects (Phase 2 G3, M7):
//   GET    /api/subjects?status=active|inactive|all  → subjects with how much uses them (staff)
//   POST   /api/subjects                             → create (admin)
//   PUT    /api/subjects/:id                         → edit name, Amharic name, code, grade,
//                                                       is_active (admin; only the fields sent)
//   DELETE /api/subjects/:id                         → delete an unused subject (admin); one in
//                                                       use answers 409: deactivate it instead
// A subject is in use when a timetable slot, a teacher's subject list, a class assignment or
// an exam refers to it. Codes are stored upper case and are unique ignoring case. Audited.
// ============================================================

const db                  = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { audit }           = require('../utils/audit');
const { inTransaction }   = require('../utils/transaction');

const CODE = /^[A-Z0-9-]{1,10}$/;

const SUBJECT_COLUMNS = `
  s.id, s.name, s.name_am, s.code, s.grade_level, s.is_active, s.created_at,
  (SELECT COUNT(*)::int FROM timetable t        WHERE t.subject_id = s.id) AS timetable_slots,
  (SELECT COUNT(*)::int FROM teacher_subjects x WHERE x.subject_id = s.id) AS teachers,
  (SELECT COUNT(*)::int FROM teacher_classes x  WHERE x.subject_id = s.id) AS class_assignments,
  (SELECT COUNT(*)::int FROM exams e            WHERE e.subject_id = s.id) AS exams`;

const loadSubject = async (q, id) => {
  const s = (await q.query(`SELECT ${SUBJECT_COLUMNS} FROM subjects s WHERE s.id = $1`, [id])).rows[0];
  if (s) s.in_use = s.timetable_slots + s.teachers + s.class_assignments + s.exams > 0;
  return s;
};

// Trims and checks the fields sent; returns { values } or { error, field }
const checkFields = (b, partial) => {
  const v = {};
  if (!partial || b.name !== undefined) {
    v.name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!v.name) return { error: 'name is required.', field: 'name' };
    if (v.name.length > 100) return { error: 'name must be at most 100 characters.', field: 'name' };
  }
  if (b.name_am !== undefined) {
    if (b.name_am !== null && typeof b.name_am !== 'string') return { error: 'name_am must be text.', field: 'name_am' };
    v.name_am = b.name_am?.trim() || null;
    if (v.name_am && v.name_am.length > 100) return { error: 'name_am must be at most 100 characters.', field: 'name_am' };
  }
  if (!partial || b.code !== undefined) {
    v.code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
    if (!CODE.test(v.code)) return { error: 'code must be 1 to 10 letters, digits or "-", e.g. MATH or PHY-11.', field: 'code' };
  }
  if (b.grade_level !== undefined) {
    if (b.grade_level !== null && (!Number.isInteger(b.grade_level) || b.grade_level < 1 || b.grade_level > 12)) {
      return { error: 'grade_level must be a whole number from 1 to 12, or null for every grade.', field: 'grade_level' };
    }
    v.grade_level = b.grade_level;
  }
  if (b.is_active !== undefined) {
    if (typeof b.is_active !== 'boolean') return { error: 'is_active must be true or false.', field: 'is_active' };
    if (!partial) return { error: 'A new subject is always active.', field: 'is_active' };
    v.is_active = b.is_active;
  }
  return { values: v };
};

const codeTaken = async (code, exceptId = null) => (await db.query(
  'SELECT 1 FROM subjects WHERE upper(code) = $1 AND ($2::uuid IS NULL OR id <> $2)', [code, exceptId])).rows.length > 0;


// ── GET /api/subjects ────────────────────────────────────────
const getSubjects = async (req, res) => {
  try {
    const status = req.query.status ?? 'all';
    if (!['active', 'inactive', 'all'].includes(status)) {
      return sendError(res, 'status must be active, inactive or all.', 400, { field: 'status' });
    }
    const where = status === 'all' ? '' : `WHERE s.is_active = ${status === 'active'}`;
    const { rows } = await db.query(`SELECT ${SUBJECT_COLUMNS} FROM subjects s ${where} ORDER BY s.name`);
    for (const s of rows) s.in_use = s.timetable_slots + s.teachers + s.class_assignments + s.exams > 0;
    return sendSuccess(res, rows, `${rows.length} subject(s) found.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};


// ── POST /api/subjects ───────────────────────────────────────
const createSubject = async (req, res) => {
  try {
    const { values: v, error, field } = checkFields(req.body || {}, false);
    if (error) return sendError(res, error, 400, { field });
    if (await codeTaken(v.code)) return sendError(res, `The code ${v.code} is already used by another subject.`, 409, { field: 'code' });

    const created = await inTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO subjects (name, name_am, code, grade_level) VALUES ($1, $2, $3, $4) RETURNING id',
        [v.name, v.name_am ?? null, v.code, v.grade_level ?? null]);
      await audit(client, req, 'subject.created', 'subject', rows[0].id,
        { name: v.name, name_am: v.name_am ?? null, code: v.code, grade_level: v.grade_level ?? null });
      return loadSubject(client, rows[0].id);
    });
    return sendSuccess(res, created, `${created.name} created.`, 201);
  } catch (err) {
    if (err.code === '23505') return sendError(res, 'This code is already used by another subject.', 409, { field: 'code' });
    return sendServerError(res, err, 'Server error.');
  }
};


// ── PUT /api/subjects/:id ────────────────────────────────────
// Only the fields sent change. A change of is_active alone is audited as
// subject.deactivated / subject.reactivated, other changes as subject.updated.
const updateSubject = async (req, res) => {
  try {
    const { id } = req.params;
    const before = await loadSubject(db, id);
    if (!before) return sendError(res, 'Subject not found.', 404);
    const { values: v, error, field } = checkFields(req.body || {}, true);
    if (error) return sendError(res, error, 400, { field });
    if (v.code && v.code !== before.code.toUpperCase() && await codeTaken(v.code, id)) {
      return sendError(res, `The code ${v.code} is already used by another subject.`, 409, { field: 'code' });
    }

    const changed = Object.keys(v).filter((k) => v[k] !== before[k]);
    const updated = await inTransaction(async (client) => {
      if (!changed.length) return before;
      const sets = changed.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await client.query(`UPDATE subjects SET ${sets} WHERE id = $1`, [id, ...changed.map((k) => v[k])]);
      const details = changed.filter((k) => k !== 'is_active');
      if (details.length) {
        await audit(client, req, 'subject.updated', 'subject', id, {
          name: v.name ?? before.name, code: v.code ?? before.code,
          old: Object.fromEntries(details.map((k) => [k, before[k]])),
          new: Object.fromEntries(details.map((k) => [k, v[k]])),
        });
      }
      if (changed.includes('is_active')) {
        await audit(client, req, v.is_active ? 'subject.reactivated' : 'subject.deactivated', 'subject', id,
          { name: v.name ?? before.name, code: v.code ?? before.code });
      }
      return loadSubject(client, id);
    });
    return sendSuccess(res, updated, changed.length ? `${updated.name} updated.` : 'Nothing changed.');
  } catch (err) {
    if (err.code === '23505') return sendError(res, 'This code is already used by another subject.', 409, { field: 'code' });
    return sendServerError(res, err, 'Server error.');
  }
};


// ── DELETE /api/subjects/:id ─────────────────────────────────
const deleteSubject = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await inTransaction(async (client) => {
      // Lock the subject so a slot or exam added at the same moment cannot slip in unseen
      const locked = (await client.query('SELECT id FROM subjects WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!locked) return { status: 404 };
      const s = await loadSubject(client, id);
      if (s.in_use) return { status: 409, s };
      await client.query('DELETE FROM subjects WHERE id = $1', [id]);
      await audit(client, req, 'subject.deleted', 'subject', id,
        { name: s.name, name_am: s.name_am, code: s.code, grade_level: s.grade_level });
      return { status: 200, s };
    });
    if (result.status === 404) return sendError(res, 'Subject not found.', 404);
    if (result.status === 409) {
      const { s } = result;
      return sendError(res, `${s.name} is in use (${s.timetable_slots} timetable slot(s), ${s.teachers} teacher(s), `
        + `${s.class_assignments} class assignment(s), ${s.exams} exam(s)). Deactivate it instead.`, 409,
      { timetable_slots: s.timetable_slots, teachers: s.teachers, class_assignments: s.class_assignments, exams: s.exams });
    }
    return sendSuccess(res, null, `${result.s.name} deleted.`);
  } catch (err) {
    if (err.code === '23503') return sendError(res, 'This subject is in use. Deactivate it instead.', 409);
    return sendServerError(res, err, 'Server error.');
  }
};

// An inactive subject is refused for new slots, assignments and exams.
// Returns the 400 message or null (unknown ids are left to validateBodyIds).
const inactiveSubjectError = async (q, subjectId, field = 'subject_id') => {
  if (!subjectId) return null;
  const { rows } = await q.query('SELECT name, is_active FROM subjects WHERE id::text = $1', [String(subjectId)]);
  return rows[0] && !rows[0].is_active ? `${field}: ${rows[0].name} is inactive.` : null;
};

module.exports = { getSubjects, createSubject, updateSubject, deleteSubject, inactiveSubjectError };
