// src/controllers/resultsAdmin.controller.js
// ============================================================
// Conduct, manual promotion decisions and semester locks (B2, PHASE2_PLAN §5.2, migration 022):
//   GET /api/results/class/:classId/conduct?semester=1|2   (A, P, homeroom T, T of the class)
//   PUT /api/results/class/:classId/conduct                 (A, homeroom T)
//       { semester, entries: [{ student_id, conduct: 'A'|'B'|'C'|'D'|null, remark? }] }   null clears
//   PUT /api/results/student/:studentId/promotion           (A) { academic_year_id, promoted: true|false|null, note? }
//   PUT /api/results/class/:classId/promotion               (A) { decisions: [{ student_id, promoted, note? }] }
//   GET /api/results/locks?academic_year_id=                (A, P)
//   POST /api/results/locks                                 (A) { academic_year_id, semester, class_id?, reason? }
//   DELETE /api/results/locks/:id                           (A) { reason? }
// Every write is audited and refused (409) while its semester is locked (promotion decisions:
// while semester 2 is locked).
// ============================================================

const db = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { inTransaction } = require('../utils/transaction');
const { parseSemester, semesterNumber } = require('../utils/semesters');
const { academicYearEthiopian } = require('../utils/ethiopianDate');
const { loadClass, ResultsError } = require('../services/results.service');
const { LockedError, assertSemesterUnlocked } = require('../services/locks.service');

const CONDUCT = ['A', 'B', 'C', 'D'];
const MAX_REMARK = 300;
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));

class BadRequest extends Error { constructor(message, errors, status = 400) { super(message); this.status = status; this.errors = errors; } }

const fail = (res, err, msg) => ((err instanceof LockedError || err instanceof ResultsError || err instanceof BadRequest)
  ? sendError(res, err.message, err.status, err.errors)
  : sendServerError(res, err, msg));

// Students who belong to a class: active in it now, or with a score in its exams
const classStudentIds = async (q, classId) => new Set((await q.query(
  `SELECT s.id FROM students s WHERE (s.class_id = $1 AND s.status = 'active')
      OR EXISTS (SELECT 1 FROM grades g JOIN exams e ON e.id = g.exam_id WHERE g.student_id = s.id AND e.class_id = $1)`,
  [classId])).rows.map((r) => r.id));

const classOr404 = async (classId) => {
  const cls = await loadClass(db, classId);
  if (!cls) throw new BadRequest('Class not found.', null, 404);
  return cls;
};

// ── Conduct ──────────────────────────────────────────────────
const getConduct = async (req, res) => {
  try {
    const semester = parseSemester(req.query.semester);
    if (!semester) return sendError(res, 'semester must be 1 or 2.', 400, { field: 'semester' });
    const cls = await classOr404(req.params.classId);
    const { rows } = await db.query(
      `SELECT s.id AS student_id, s.student_number, s.first_name, s.fathers_name, s.last_name,
              s.first_name_am, s.fathers_name_am, s.last_name_am,
              sc.conduct, sc.remark, sc.updated_at, u.email AS entered_by_email
       FROM students s
       LEFT JOIN semester_conduct sc ON sc.student_id = s.id AND sc.academic_year_id = $2 AND sc.semester = $3
       LEFT JOIN users u ON u.id = sc.entered_by
       WHERE (s.class_id = $1 AND s.status = 'active')
          OR EXISTS (SELECT 1 FROM grades g JOIN exams e ON e.id = g.exam_id WHERE g.student_id = s.id AND e.class_id = $1)
          OR sc.class_id = $1
       ORDER BY s.first_name, s.last_name`, [cls.id, cls.academic_year_id, semester]);
    return sendSuccess(res, { class_id: cls.id, academic_year_id: cls.academic_year_id, semester, students: rows }, 'Conduct retrieved.');
  } catch (err) {
    return fail(res, err, 'Server error.');
  }
};

const putConduct = async (req, res) => {
  try {
    const { entries } = req.body || {};
    const semester = parseSemester(req.body?.semester);
    if (!semester) return sendError(res, 'semester must be 1 or 2.', 400, { field: 'semester' });
    if (!Array.isArray(entries) || !entries.length) return sendError(res, 'entries[] is required.', 400, { field: 'entries' });
    const cls = await classOr404(req.params.classId);
    if (req.body.academic_year_id !== undefined && String(req.body.academic_year_id) !== cls.academic_year_id) {
      return sendError(res, "academic_year_id must be the class's academic year.", 400, { field: 'academic_year_id' });
    }
    const seen = new Set();
    const clean = entries.map((e, i) => {
      if (!e || typeof e !== 'object' || !isUuid(e.student_id)) throw new BadRequest('Each entry needs a student_id.', { field: `entries[${i}].student_id` });
      const sid = String(e.student_id).toLowerCase();
      if (seen.has(sid)) throw new BadRequest('The same student appears twice.', { field: `entries[${i}].student_id` });
      seen.add(sid);
      if (e.conduct !== null && !CONDUCT.includes(e.conduct)) throw new BadRequest(`conduct must be one of ${CONDUCT.join(', ')} (or null to clear).`, { field: `entries[${i}].conduct` });
      if (e.remark !== undefined && e.remark !== null && typeof e.remark !== 'string') throw new BadRequest('remark must be text.', { field: `entries[${i}].remark` });
      const remark = (e.remark ?? '').trim() || null;
      if (remark && remark.length > MAX_REMARK) throw new BadRequest(`remark can be at most ${MAX_REMARK} characters.`, { field: `entries[${i}].remark` });
      return { student_id: sid, conduct: e.conduct, remark };
    });
    const saved = await inTransaction(async (client) => {
      await assertSemesterUnlocked(client, { classId: cls.id, yearId: cls.academic_year_id, semester, className: cls.name });
      const members = await classStudentIds(client, cls.id);
      const outside = clean.filter((e) => !members.has(e.student_id)).map((e) => e.student_id);
      if (outside.length) throw new BadRequest('Some students are not in this class.', { student_ids: outside }, 403);
      let n = 0;
      for (const e of clean) {
        if (e.conduct === null) {
          await client.query('DELETE FROM semester_conduct WHERE student_id = $1 AND academic_year_id = $2 AND semester = $3', [e.student_id, cls.academic_year_id, semester]);
        } else {
          await client.query(
            `INSERT INTO semester_conduct (student_id, academic_year_id, semester, class_id, conduct, remark, entered_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (student_id, academic_year_id, semester)
             DO UPDATE SET class_id = EXCLUDED.class_id, conduct = EXCLUDED.conduct, remark = EXCLUDED.remark,
                           entered_by = EXCLUDED.entered_by, updated_at = NOW()`,
            [e.student_id, cls.academic_year_id, semester, cls.id, e.conduct, e.remark, req.user.id]);
        }
        n++;
      }
      await audit(client, req, 'results.conduct_saved', 'class', cls.id, { semester, entries: clean });
      return n;
    });
    return sendSuccess(res, { saved }, `Conduct saved for ${saved} student(s).`);
  } catch (err) {
    return fail(res, err, 'Server error while saving conduct.');
  }
};

// ── Manual promotion decisions (D26) ─────────────────────────
const checkDecision = (d, field) => {
  if (d.promoted !== null && typeof d.promoted !== 'boolean') throw new BadRequest('promoted must be true, false or null (to clear).', { field: `${field}promoted` });
  if (d.note !== undefined && d.note !== null && typeof d.note !== 'string') throw new BadRequest('note must be text.', { field: `${field}note` });
  const note = (d.note ?? '').trim() || null;
  if (note && note.length > MAX_REMARK) throw new BadRequest(`note can be at most ${MAX_REMARK} characters.`, { field: `${field}note` });
  return { promoted: d.promoted, note };
};

const saveDecisions = async (req, cls, decisions) => inTransaction(async (client) => {
  await assertSemesterUnlocked(client, { classId: cls.id, yearId: cls.academic_year_id, semester: 'semester2', className: cls.name });
  const members = await classStudentIds(client, cls.id);
  const outside = decisions.filter((d) => !members.has(d.student_id)).map((d) => d.student_id);
  if (outside.length) throw new BadRequest('Some students are not in this class.', { student_ids: outside }, 403);
  for (const d of decisions) {
    if (d.promoted === null) {
      await client.query('DELETE FROM promotion_decisions WHERE student_id = $1 AND academic_year_id = $2', [d.student_id, cls.academic_year_id]);
    } else {
      await client.query(
        `INSERT INTO promotion_decisions (student_id, academic_year_id, promoted, note, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (student_id, academic_year_id)
         DO UPDATE SET promoted = EXCLUDED.promoted, note = EXCLUDED.note, decided_by = EXCLUDED.decided_by, decided_at = NOW()`,
        [d.student_id, cls.academic_year_id, d.promoted, d.note, req.user.id]);
    }
  }
  await audit(client, req, 'results.promotion_decided', 'class', cls.id, { academic_year_id: cls.academic_year_id, decisions });
  return decisions.length;
});

const putStudentPromotion = async (req, res) => {
  try {
    const { academic_year_id } = req.body || {};
    if (!isUuid(academic_year_id)) return sendError(res, 'academic_year_id is required.', 400, { field: 'academic_year_id' });
    const d = checkDecision(req.body, '');
    const sid = String(req.params.studentId).toLowerCase();
    // The student's class in that year: the current one if in it, else the one with their scores
    const { rows } = await db.query(
      `SELECT c.id FROM classes c WHERE c.academic_year_id = $2 AND (
         c.id = (SELECT class_id FROM students WHERE id = $1)
         OR c.id IN (SELECT e.class_id FROM grades g JOIN exams e ON e.id = g.exam_id WHERE g.student_id = $1))
       ORDER BY (c.id = (SELECT class_id FROM students WHERE id = $1)) DESC LIMIT 1`, [sid, academic_year_id]);
    if (!rows[0]) return sendError(res, 'This student has no class in that academic year.', 404);
    const cls = await classOr404(rows[0].id);
    await saveDecisions(req, cls, [{ student_id: sid, ...d }]);
    return sendSuccess(res, { student_id: sid, academic_year_id, ...d }, d.promoted === null ? 'Decision cleared.' : 'Decision saved.');
  } catch (err) {
    return fail(res, err, 'Server error while saving the decision.');
  }
};

const putClassPromotion = async (req, res) => {
  try {
    const { decisions } = req.body || {};
    if (!Array.isArray(decisions) || !decisions.length) return sendError(res, 'decisions[] is required.', 400, { field: 'decisions' });
    const seen = new Set();
    const clean = decisions.map((d, i) => {
      if (!d || typeof d !== 'object' || !isUuid(d.student_id)) throw new BadRequest('Each decision needs a student_id.', { field: `decisions[${i}].student_id` });
      const sid = String(d.student_id).toLowerCase();
      if (seen.has(sid)) throw new BadRequest('The same student appears twice.', { field: `decisions[${i}].student_id` });
      seen.add(sid);
      return { student_id: sid, ...checkDecision(d, `decisions[${i}].`) };
    });
    const cls = await classOr404(req.params.classId);
    const n = await saveDecisions(req, cls, clean);
    return sendSuccess(res, { saved: n }, `Promotion decisions saved for ${n} student(s).`);
  } catch (err) {
    return fail(res, err, 'Server error while saving decisions.');
  }
};

// ── Semester locks (D29) ─────────────────────────────────────
const getLocks = async (req, res) => {
  try {
    const { academic_year_id } = req.query;
    if (academic_year_id !== undefined && !isUuid(academic_year_id)) return sendError(res, 'academic_year_id does not exist.', 400, { field: 'academic_year_id' });
    const { rows } = await db.query(
      `SELECT l.id, l.academic_year_id, y.name AS year_name, l.semester, l.class_id, c.name AS class_name,
              l.reason, l.locked_at, u.email AS locked_by_email
       FROM semester_locks l JOIN academic_years y ON y.id = l.academic_year_id
       LEFT JOIN classes c ON c.id = l.class_id LEFT JOIN users u ON u.id = l.locked_by
       WHERE ($1::uuid IS NULL OR l.academic_year_id = $1)
       ORDER BY y.start_date DESC, l.semester, c.name NULLS FIRST`, [academic_year_id ?? null]);
    return sendSuccess(res, rows, `${rows.length} lock(s).`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

const createLock = async (req, res) => {
  try {
    const { academic_year_id, class_id = null, reason } = req.body || {};
    const semester = parseSemester(req.body?.semester);
    if (!isUuid(academic_year_id)) return sendError(res, 'academic_year_id is required.', 400, { field: 'academic_year_id' });
    if (!semester) return sendError(res, 'semester must be 1 or 2.', 400, { field: 'semester' });
    if (class_id !== null && !isUuid(class_id)) return sendError(res, 'class_id does not exist.', 400, { field: 'class_id' });
    if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MAX_REMARK)) return sendError(res, `reason must be text of at most ${MAX_REMARK} characters.`, 400, { field: 'reason' });
    const { rows: y } = await db.query('SELECT id, name, end_date FROM academic_years WHERE id = $1', [academic_year_id]);
    if (!y[0]) return sendError(res, 'academic_year_id does not exist.', 400, { field: 'academic_year_id' });
    if (class_id) {
      const { rows: c } = await db.query('SELECT academic_year_id FROM classes WHERE id = $1', [class_id]);
      if (!c[0]) return sendError(res, 'class_id does not exist.', 400, { field: 'class_id' });
      if (c[0].academic_year_id !== academic_year_id) return sendError(res, 'The class is not in that academic year.', 400, { field: 'class_id' });
    }
    const lock = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO semester_locks (academic_year_id, semester, class_id, reason, locked_by)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
        [academic_year_id, semester, class_id, reason?.trim() || null, req.user.id]);
      if (!rows[0]) throw new BadRequest(`Semester ${semesterNumber(semester)} is already locked${class_id ? ' for this class' : ' for the whole school'}.`, null, 409);
      await audit(client, req, 'results.semester_locked', 'semester_lock', rows[0].id, { academic_year_id, semester, class_id, reason: rows[0].reason });
      return rows[0];
    });
    return sendSuccess(res, lock, `Semester ${semesterNumber(semester)} ${academicYearEthiopian(y[0].end_date)} E.C. locked${class_id ? ' for the class' : ' for the whole school'}.`, 201);
  } catch (err) {
    return fail(res, err, 'Server error while locking.');
  }
};

const deleteLock = async (req, res) => {
  try {
    const { reason } = req.body || {};
    if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MAX_REMARK)) return sendError(res, `reason must be text of at most ${MAX_REMARK} characters.`, 400, { field: 'reason' });
    const removed = await inTransaction(async (client) => {
      const { rows } = await client.query('DELETE FROM semester_locks WHERE id::text = $1 RETURNING *', [String(req.params.id).toLowerCase()]);
      if (!rows[0]) throw new BadRequest('Lock not found.', null, 404);
      await audit(client, req, 'results.semester_unlocked', 'semester_lock', rows[0].id,
        { academic_year_id: rows[0].academic_year_id, semester: rows[0].semester, class_id: rows[0].class_id, reason: reason?.trim() || null });
      return rows[0];
    });
    return sendSuccess(res, removed, `Semester ${semesterNumber(removed.semester)} unlocked.`);
  } catch (err) {
    return fail(res, err, 'Server error while unlocking.');
  }
};

module.exports = { getConduct, putConduct, putStudentPromotion, putClassPromotion, getLocks, createLock, deleteLock };
