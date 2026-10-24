// src/controllers/results.controller.js
// ============================================================
// Results (B2, PHASE2_PLAN §5.2), all from services/results.service.js:
//   GET /api/results/student/:studentId?academic_year_id=   (scoped like report cards; no class or
//       scores yet: 200 with class, academic_year, semesters and year null)
//   GET /api/results/class/:classId?semester=1|2|year         (A, P, T own class)
// School settings:
//   GET /api/settings          (staff)  → { key: value }
//   PUT /api/settings/:key     (admin)  { value }, validated per key, audited
// ============================================================

const db = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { inTransaction } = require('../utils/transaction');
const { parseSemester } = require('../utils/semesters');
const { classResults, studentResults, ResultsError } = require('../services/results.service');

const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));

const fail = (res, err, msg) => (err instanceof ResultsError
  ? sendError(res, err.message, err.status, err.errors)
  : sendServerError(res, err, msg));

// ── GET /api/results/student/:studentId ──────────────────────
const getStudentResults = async (req, res) => {
  try {
    const { academic_year_id } = req.query;
    if (academic_year_id !== undefined && !isUuid(academic_year_id)) {
      return sendError(res, 'academic_year_id does not exist.', 400, { field: 'academic_year_id' });
    }
    // No class or scores yet is normal (a new student): 200 with an empty result, not 404
    const data = await studentResults(req.params.studentId, academic_year_id, db, { allowEmpty: true });
    return sendSuccess(res, data, data.class ? 'Results retrieved.' : 'No results yet.');
  } catch (err) {
    return fail(res, err, 'Server error while computing results.');
  }
};

// ── GET /api/results/class/:classId ──────────────────────────
const getClassResults = async (req, res) => {
  try {
    const raw = req.query.semester;
    const semester = raw === 'year' ? 'year' : parseSemester(raw);
    if (!semester) return sendError(res, 'semester must be 1, 2 or year.', 400, { field: 'semester' });
    const data = await classResults(req.params.classId, semester);
    return sendSuccess(res, data, 'Class results retrieved.');
  } catch (err) {
    return fail(res, err, 'Server error while computing results.');
  }
};

// ── Settings ─────────────────────────────────────────────────
// Each key: its validation. Unknown keys are refused.
const SETTINGS = {
  pass_yearly_average: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
    ? null : 'pass_yearly_average must be a number from 0 to 100.'),
  manual_promotion_grades: (v) => (Array.isArray(v) && v.every((g) => Number.isInteger(g) && g >= 1 && g <= 12) && new Set(v).size === v.length
    ? null : 'manual_promotion_grades must be a list of different grade levels from 1 to 12, e.g. [6, 8, 12].'),
  period_times: (v) => periodTimesError(v),
};

// period_times (M7): periods 1-8 once each, "HH:MM" start before end, in order without overlaps
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const periodTimesError = (v) => {
  const shape = 'period_times must list periods 1 to 8, each once, as { period, start: "HH:MM", end: "HH:MM" }.';
  if (!Array.isArray(v) || v.length !== 8) return shape;
  const sorted = [...v].sort((a, b) => a?.period - b?.period);
  for (let i = 0; i < 8; i++) {
    const p = sorted[i];
    if (!p || p.period !== i + 1 || !HHMM.test(p.start) || !HHMM.test(p.end)) return shape;
    if (p.start >= p.end) return `Period ${p.period}: the end must be after the start.`;
    if (i > 0 && p.start < sorted[i - 1].end) return `Period ${p.period} starts before period ${i} ends.`;
  }
  return null;
};
const normalize = {
  manual_promotion_grades: (v) => [...v].sort((a, b) => a - b),
  period_times: (v) => [...v].sort((a, b) => a.period - b.period).map(({ period, start, end }) => ({ period, start, end })),
};

const getSettings = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT key, value, updated_at FROM school_settings ORDER BY key');
    return sendSuccess(res, Object.fromEntries(rows.map((r) => [r.key, r.value])), 'School settings.');
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

const updateSetting = async (req, res) => {
  try {
    const { key } = req.params;
    if (!SETTINGS[key]) return sendError(res, `Unknown setting "${key}". Known: ${Object.keys(SETTINGS).join(', ')}.`, 404);
    const value = req.body?.value;
    const bad = SETTINGS[key](value);
    if (bad) return sendError(res, bad, 400, { field: 'value' });
    const saved = await inTransaction(async (client) => {
      const old = (await client.query('SELECT value FROM school_settings WHERE key = $1 FOR UPDATE', [key])).rows[0]?.value ?? null;
      const value2 = normalize[key] ? normalize[key](value) : value;
      const { rows } = await client.query(
        `INSERT INTO school_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING key, value, updated_at`, [key, JSON.stringify(value2), req.user.id]);
      await audit(client, req, 'settings.updated', 'school_setting', null, { key, old, new: value2 });
      return rows[0];
    });
    return sendSuccess(res, saved, `Setting ${key} saved.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error.');
  }
};

module.exports = { getStudentResults, getClassResults, getSettings, updateSetting };
