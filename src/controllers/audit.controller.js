// src/controllers/audit.controller.js
// ============================================================
// Audit log viewer (Phase 2 G8, M7), admin only:
//   GET /api/accounts/audit?from=&to=&user_id=&action=&target_type=&page=&limit=
// from / to: YYYY-MM-DD (inclusive, the app converts Ethiopian dates). Newest first.
// Each entry has the acting user and a label for its target (a student's, teacher's,
// parent's or user's name, a class or subject name, a year), so the app can write a
// readable sentence. `filters` lists the actions, target types and users that occur.
// ============================================================

const db                  = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const { isUuid }          = require('../middleware/validateIds.middleware');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (s) => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const USER_NAME = (u, t, p) => `COALESCE(${t}.first_name || ' ' || ${t}.last_name, ${p}.full_name, ${u}.display_name, ${u}.email)`;

const getAuditLog = async (req, res) => {
  try {
    const { from, to, user_id, action, target_type } = req.query;
    const pg = parsePagination({ limit: 50, ...req.query });
    if (pg.error) return sendError(res, pg.error, 400);
    for (const [k, v] of [['from', from], ['to', to]]) {
      if (v !== undefined && !realDate(v)) return sendError(res, `${k} must be a date YYYY-MM-DD.`, 400, { field: k });
    }
    if (from && to && to < from) return sendError(res, 'to must not be before from.', 400, { field: 'to' });
    if (user_id !== undefined && !isUuid(user_id)) return sendError(res, 'user_id does not exist.', 400, { field: 'user_id' });

    const conditions = []; const params = [];
    const add = (sql, v) => { params.push(v); conditions.push(sql.replace('?', `$${params.length}`)); };
    if (from) add('a.created_at >= ?::date', from);
    if (to) add("a.created_at < ?::date + 1", to);
    if (user_id) add('a.user_id = ?', user_id);
    if (action) add('a.action = ?', action);
    if (target_type) add('a.target_type = ?', target_type);
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await db.query(
      `SELECT a.id, a.created_at, a.action, a.target_type, a.target_id, a.old_data, a.new_data, a.ip_address,
              a.user_id, u.email AS user_email, u.role AS user_role, ${USER_NAME('u', 'ut', 'up')} AS user_name,
              CASE a.target_type
                WHEN 'student' THEN st.first_name || ' ' || st.last_name
                WHEN 'teacher' THEN te.first_name || ' ' || te.last_name
                WHEN 'parent'  THEN pa.full_name
                WHEN 'class'   THEN cl.name || ' (' || cy.name || ')'
                WHEN 'subject' THEN su.name
                WHEN 'academic_year' THEN ay.name
                WHEN 'user'    THEN ${USER_NAME('tu', 'tut', 'tup')}
              END AS target_label,
              CASE a.target_type
                WHEN 'student' THEN NULLIF(concat_ws(' ', st.first_name_am, st.last_name_am), '')
                WHEN 'teacher' THEN NULLIF(concat_ws(' ', te.first_name_am, te.last_name_am), '')
                WHEN 'parent'  THEN pa.full_name_am
                WHEN 'subject' THEN su.name_am
              END AS target_label_am
       FROM audit_logs a
       LEFT JOIN users u          ON u.id = a.user_id
       LEFT JOIN teachers ut      ON ut.user_id = u.id
       LEFT JOIN parents up       ON up.user_id = u.id
       LEFT JOIN students st      ON a.target_type = 'student' AND st.id = a.target_id
       LEFT JOIN teachers te      ON a.target_type = 'teacher' AND te.id = a.target_id
       LEFT JOIN parents pa       ON a.target_type = 'parent'  AND pa.id = a.target_id
       LEFT JOIN classes cl       ON a.target_type = 'class'   AND cl.id = a.target_id
       LEFT JOIN academic_years cy ON cy.id = cl.academic_year_id
       LEFT JOIN subjects su      ON a.target_type = 'subject' AND su.id = a.target_id
       LEFT JOIN academic_years ay ON a.target_type = 'academic_year' AND ay.id = a.target_id
       LEFT JOIN users tu         ON a.target_type = 'user'    AND tu.id = a.target_id
       LEFT JOIN teachers tut     ON tut.user_id = tu.id
       LEFT JOIN parents tup      ON tup.user_id = tu.id
       ${where}
       ORDER BY a.created_at DESC, a.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pg.limit, pg.offset]);
    const total = (await db.query(`SELECT COUNT(*)::int AS n FROM audit_logs a ${where}`, params)).rows[0].n;

    // What the filters can offer (whole log, not only this page)
    const actions = (await db.query('SELECT action, COUNT(*)::int AS count FROM audit_logs GROUP BY action ORDER BY action')).rows;
    const targetTypes = (await db.query(
      'SELECT target_type, COUNT(*)::int AS count FROM audit_logs WHERE target_type IS NOT NULL GROUP BY target_type ORDER BY target_type')).rows;
    const users = (await db.query(
      `SELECT u.id, u.email, u.role, ${USER_NAME('u', 'ut', 'up')} AS name
       FROM users u
       LEFT JOIN teachers ut ON ut.user_id = u.id
       LEFT JOIN parents up  ON up.user_id = u.id
       WHERE u.id IN (SELECT DISTINCT user_id FROM audit_logs WHERE user_id IS NOT NULL)
       ORDER BY name`)).rows;

    return sendSuccess(res, {
      entries: rows,
      pagination: { total, page: pg.page, limit: pg.limit, totalPages: Math.ceil(total / pg.limit) },
      filters: { actions, target_types: targetTypes, users },
    }, `${total} audit entr${total === 1 ? 'y' : 'ies'}.`);
  } catch (err) {
    return sendServerError(res, err, 'Server error while reading the audit log.');
  }
};

module.exports = { getAuditLog };
