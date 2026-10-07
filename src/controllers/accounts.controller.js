// src/controllers/accounts.controller.js
// ============================================================
// School-created accounts (no public sign-up). Admin only.
//   GET    /api/accounts/users                     → find users
//   POST   /api/accounts/students/:studentId/login → login for an existing student
//   GET    /api/accounts/parents                   → parents + linked children
//   POST   /api/accounts/parents                   → parent profile + login
//   POST   /api/accounts/parents/:parentId/children           → link a child
//   DELETE /api/accounts/parents/:parentId/children/:studentId → unlink
//   POST   /api/accounts/principals                → principal login
//   POST   /api/accounts/users/:userId/reset-password → new temporary password
//
// New logins get a random temporary password, returned ONCE in
// data.temporary_password, and must_change_password = TRUE.
// ============================================================

const bcrypt              = require('bcryptjs');
const db                  = require('../config/db');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { generateTemporaryPassword } = require('../utils/password');
const { revokeAllSessions } = require('../utils/sessions');
const { parsePagination } = require('../utils/pagination');

const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RELATIONSHIPS = ['father', 'mother', 'guardian', 'other'];
const ROLES         = ['admin', 'principal', 'teacher', 'parent', 'student'];

const normalizeEmail = (email) => String(email || '').toLowerCase().trim();

// Insert a login with a fresh temporary password. Returns { user, temporaryPassword }.
const createLogin = async (client, email, role, displayName = null) => {
  const temporaryPassword = generateTemporaryPassword();
  const hash = await bcrypt.hash(temporaryPassword, 12);
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, role, must_change_password, display_name)
     VALUES ($1, $2, $3, TRUE, $4) RETURNING id, email, role`,
    [email, hash, role, displayName]
  );
  return { user: rows[0], temporaryPassword };
};

const audit = (client, req, action, targetType, targetId, data = null) => client.query(
  `INSERT INTO audit_logs (user_id, action, target_type, target_id, new_data)
   VALUES ($1, $2, $3, $4, $5)`,
  [req.user.id, action, targetType, targetId, data ? JSON.stringify(data) : null]
);

const emailTaken = async (email) =>
  (await db.query('SELECT 1 FROM users WHERE email = $1', [email])).rows.length > 0;

// Runs fn(client) in a transaction
const inTransaction = async (fn) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};


// ── GET /api/accounts/users ──────────────────────────────────
const getUsers = async (req, res) => {
  try {
    const { role, search = '' } = req.query;
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);
    if (role && !ROLES.includes(role)) return sendError(res, `role must be one of: ${ROLES.join(', ')}`, 400);

    const conditions = []; const params = [];
    if (role) { params.push(role); conditions.push(`u.role = $${params.length}`); }
    if (search.trim()) { params.push(`%${search.trim()}%`); conditions.push(`(u.email ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await db.query(
      `SELECT u.id, u.email, u.role, u.display_name, u.is_active, u.must_change_password,
              u.last_login, u.created_at,
              COALESCE(t.first_name || ' ' || t.last_name, s.first_name || ' ' || s.last_name,
                       p.full_name, u.display_name) AS full_name,
              t.id AS teacher_id, s.id AS student_id, p.id AS parent_id
       FROM users u
       LEFT JOIN teachers t ON t.user_id = u.id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN parents  p ON p.user_id = u.id
       ${where}
       ORDER BY u.role, u.email
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pg.limit, pg.offset]
    );
    const { rows: ct } = await db.query(
      `SELECT COUNT(*)::int n FROM users u ${where}`, params);

    return sendSuccess(res, {
      users: rows,
      pagination: { total: ct[0].n, page: pg.page, limit: pg.limit, totalPages: Math.ceil(ct[0].n / pg.limit) },
    }, `Found ${ct[0].n} user(s).`);
  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching users.');
  }
};


// ── POST /api/accounts/students/:studentId/login ─────────────
const createStudentLogin = async (req, res) => {
  try {
    const { studentId } = req.params;
    const email = normalizeEmail(req.body.email);
    if (!EMAIL_RE.test(email)) return sendError(res, 'A valid email is required.', 400);

    const { rows: stu } = await db.query(
      'SELECT id, user_id, status, student_number, first_name, last_name FROM students WHERE id::text = $1',
      [studentId]);
    if (!stu[0]) return sendError(res, 'Student not found.', 404);
    if (stu[0].user_id) return sendError(res, 'This student already has a login.', 409);
    if (stu[0].status !== 'active') return sendError(res, `Student is ${stu[0].status}; only active students can get a login.`, 400);
    if (await emailTaken(email)) return sendError(res, 'A user with this email already exists.', 409);

    const result = await inTransaction(async (client) => {
      const login = await createLogin(client, email, 'student');
      // user_id IS NULL guards against a concurrent request linking a login first
      const { rowCount } = await client.query(
        'UPDATE students SET user_id = $1, updated_at = NOW() WHERE id = $2 AND user_id IS NULL',
        [login.user.id, stu[0].id]);
      if (!rowCount) throw Object.assign(new Error('student already linked'), { status: 409 });
      await audit(client, req, 'account.student_login_created', 'student', stu[0].id, { email });
      return login;
    });

    return sendSuccess(res, {
      user_id: result.user.id, email, role: 'student', student_id: stu[0].id,
      student_number: stu[0].student_number,
      temporary_password: result.temporaryPassword,
    }, `Login created for ${stu[0].student_number}. Share the temporary password privately; it must be changed at first login.`, 201);
  } catch (err) {
    if (err.status === 409) return sendError(res, 'This student already has a login.', 409);
    return sendServerError(res, err, 'Server error while creating the student login.');
  }
};


// ── GET /api/accounts/parents ────────────────────────────────
const getParents = async (req, res) => {
  try {
    const { search = '' } = req.query;
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);

    const params = [];
    let where = '';
    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      where = `WHERE p.full_name ILIKE $1 OR p.phone ILIKE $1 OR p.email ILIKE $1 OR u.email ILIKE $1`;
    }
    const { rows } = await db.query(
      `SELECT p.id, p.full_name, p.phone, p.phone_secondary, p.email, p.occupation,
              p.user_id, u.email AS login_email, u.is_active AS login_active,
              COALESCE(json_agg(json_build_object(
                'student_id', s.id, 'student_number', s.student_number,
                'name', s.first_name || ' ' || s.last_name,
                'relationship', sp.relationship, 'is_primary', sp.is_primary)
                ORDER BY s.first_name) FILTER (WHERE s.id IS NOT NULL), '[]') AS children
       FROM parents p
       LEFT JOIN users u            ON u.id = p.user_id
       LEFT JOIN student_parents sp ON sp.parent_id = p.id
       LEFT JOIN students s         ON s.id = sp.student_id
       ${where}
       GROUP BY p.id, u.email, u.is_active
       ORDER BY p.full_name
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pg.limit, pg.offset]
    );
    const { rows: ct } = await db.query(
      `SELECT COUNT(*)::int n FROM parents p LEFT JOIN users u ON u.id = p.user_id ${where}`, params);

    return sendSuccess(res, {
      parents: rows,
      pagination: { total: ct[0].n, page: pg.page, limit: pg.limit, totalPages: Math.ceil(ct[0].n / pg.limit) },
    }, `Found ${ct[0].n} parent(s).`);
  } catch (err) {
    return sendServerError(res, err, 'Server error while fetching parents.');
  }
};


// ── POST /api/accounts/parents ───────────────────────────────
const createParent = async (req, res) => {
  try {
    const { full_name, phone, phone_secondary, occupation } = req.body;
    const email = normalizeEmail(req.body.email);
    if (!full_name?.trim() || !phone?.trim()) return sendError(res, 'full_name and phone are required.', 400);
    if (!EMAIL_RE.test(email)) return sendError(res, 'A valid email is required for the login.', 400);
    if (await emailTaken(email)) return sendError(res, 'A user with this email already exists.', 409);

    const result = await inTransaction(async (client) => {
      const login = await createLogin(client, email, 'parent');
      const { rows } = await client.query(
        `INSERT INTO parents (user_id, full_name, phone, phone_secondary, email, occupation)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [login.user.id, full_name.trim(), phone.trim(), phone_secondary?.trim() || null, email, occupation?.trim() || null]);
      await audit(client, req, 'account.parent_created', 'parent', rows[0].id, { email });
      return { parent: rows[0], ...login };
    });

    return sendSuccess(res, {
      ...result.parent,
      temporary_password: result.temporaryPassword,
    }, 'Parent account created. Share the temporary password privately; it must be changed at first login.', 201);
  } catch (err) {
    return sendServerError(res, err, 'Server error while creating the parent account.');
  }
};


// ── POST /api/accounts/parents/:parentId/children ────────────
const linkChild = async (req, res) => {
  try {
    const { parentId } = req.params;
    const { student_id, relationship, is_primary = false } = req.body;
    if (!student_id) return sendError(res, 'student_id is required.', 400);
    if (!RELATIONSHIPS.includes(relationship)) {
      return sendError(res, `relationship must be one of: ${RELATIONSHIPS.join(', ')}`, 400);
    }

    const { rows: p } = await db.query('SELECT id FROM parents WHERE id::text = $1', [parentId]);
    if (!p[0]) return sendError(res, 'Parent not found.', 404);
    const { rows: s } = await db.query('SELECT id FROM students WHERE id::text = $1', [String(student_id)]);
    if (!s[0]) return sendError(res, 'Student not found.', 404);

    const primary = is_primary === true || is_primary === 'true';
    if (primary) {
      const { rows } = await db.query(
        'SELECT 1 FROM student_parents WHERE student_id = $1 AND is_primary', [s[0].id]);
      if (rows.length) return sendError(res, 'This student already has a primary contact. Unlink it or link this parent as non-primary.', 409);
    }

    const { rows } = await db.query(
      `INSERT INTO student_parents (student_id, parent_id, relationship, is_primary)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, parent_id) DO NOTHING
       RETURNING *`,
      [s[0].id, p[0].id, relationship, primary]);
    if (!rows[0]) return sendError(res, 'This parent is already linked to this student.', 409);

    await audit(db, req, 'account.parent_linked', 'student', s[0].id, { parent_id: p[0].id, relationship, is_primary: primary });
    return sendSuccess(res, rows[0], 'Parent linked to student.', 201);
  } catch (err) {
    // Unique index idx_one_primary_parent (a concurrent primary link)
    if (err.code === '23505') return sendError(res, 'This student already has a primary contact.', 409);
    return sendServerError(res, err, 'Server error while linking parent and student.');
  }
};


// ── DELETE /api/accounts/parents/:parentId/children/:studentId ─
const unlinkChild = async (req, res) => {
  try {
    const { parentId, studentId } = req.params;
    const { rows } = await db.query(
      `DELETE FROM student_parents
       WHERE parent_id::text = $1 AND student_id::text = $2
       RETURNING student_id, parent_id`,
      [parentId, studentId]);
    if (!rows[0]) return sendError(res, 'Link not found.', 404);
    await audit(db, req, 'account.parent_unlinked', 'student', rows[0].student_id, { parent_id: rows[0].parent_id });
    return sendSuccess(res, null, 'Parent unlinked from student.');
  } catch (err) {
    return sendServerError(res, err, 'Server error while unlinking parent and student.');
  }
};


// ── POST /api/accounts/principals ────────────────────────────
const createPrincipal = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const displayName = req.body.display_name?.trim();
    if (!EMAIL_RE.test(email)) return sendError(res, 'A valid email is required.', 400);
    if (!displayName) return sendError(res, 'display_name is required.', 400);
    if (await emailTaken(email)) return sendError(res, 'A user with this email already exists.', 409);

    const result = await inTransaction(async (client) => {
      const login = await createLogin(client, email, 'principal', displayName);
      await audit(client, req, 'account.principal_created', 'user', login.user.id, { email });
      return login;
    });

    return sendSuccess(res, {
      user_id: result.user.id, email, role: 'principal', display_name: displayName,
      temporary_password: result.temporaryPassword,
    }, 'Principal account created. Share the temporary password privately; it must be changed at first login.', 201);
  } catch (err) {
    return sendServerError(res, err, 'Server error while creating the principal account.');
  }
};


// ── POST /api/accounts/users/:userId/reset-password ──────────
const resetPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { rows: u } = await db.query('SELECT id, email, role FROM users WHERE id::text = $1', [userId]);
    if (!u[0]) return sendError(res, 'User not found.', 404);

    const temporaryPassword = generateTemporaryPassword();
    const hash = await bcrypt.hash(temporaryPassword, 12);
    await inTransaction(async (client) => {
      await client.query(
        `UPDATE users SET password_hash = $1, must_change_password = TRUE, updated_at = NOW()
         WHERE id = $2`, [hash, u[0].id]);
      await revokeAllSessions(u[0].id, client);
      await audit(client, req, 'account.password_reset', 'user', u[0].id);
    });

    return sendSuccess(res, {
      user_id: u[0].id, email: u[0].email, role: u[0].role,
      temporary_password: temporaryPassword,
    }, 'Password reset. All sessions were signed out; the user must change the temporary password at next login.');
  } catch (err) {
    return sendServerError(res, err, 'Server error while resetting the password.');
  }
};


module.exports = {
  getUsers, createStudentLogin, getParents, createParent,
  linkChild, unlinkChild, createPrincipal, resetPassword,
};
