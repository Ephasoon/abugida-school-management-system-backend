// src/controllers/document.controller.js
// Documents (M9, docs/PERMISSIONS.md): admin and principal see all of them; a teacher sees
// their own uploads and the shared documents that are not about a student, or about a
// student of their own classes. Upload: staff (a teacher only for students of their own
// classes). Edit the details: admin and the uploader. Delete: admin. Uploads, edits and
// deletes are audited. Parents and students see no documents.
const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { isSchoolWide, canAccessStudent, getTeacherId } = require('../utils/scope');
const { parsePagination } = require('../utils/pagination');
const { inTransaction } = require('../utils/transaction');
const { audit } = require('../utils/audit');
const { MAX_BYTES, ALLOWED_MIME, EXTENSIONS, contentMatches } = require('../config/uploads');

// Category keys (labels for the old frontend; asms-web translates the keys)
const CATEGORIES = [
  { key: 'id_document', label: 'ID Document', icon: '🪪' },
  { key: 'birth_certificate', label: 'Birth Certificate', icon: '📋' },
  { key: 'transfer_letter', label: 'Transfer Letter', icon: '📨' },
  { key: 'report_card', label: 'Report Card', icon: '📘' },
  { key: 'national_exam', label: 'National Exam Result', icon: '🎓' },
  { key: 'transcript', label: 'Transcript', icon: '📄' },
  { key: 'medical', label: 'Medical Record', icon: '🏥' },
  { key: 'photo', label: 'Photo', icon: '📷' },
  { key: 'letter', label: 'Letter', icon: '✉️' },
  { key: 'certificate', label: 'Certificate', icon: '🏆' },
  { key: 'report', label: 'Report', icon: '📊' },
  { key: 'other', label: 'Other', icon: '📁' },
];
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 1000;

class DocumentError extends Error {
  constructor(message, status, extra) { super(message); this.status = status; this.extra = extra; }
}

// The columns every read returns: student (with class), uploader name
const UPLOADER = `COALESCE(NULLIF(u.display_name, ''), ut.first_name || ' ' || ut.last_name, u.email)`;
const SELECT = `
  SELECT d.id, d.student_id, d.teacher_id, d.category, d.title, d.description, d.file_name, d.file_size,
         d.mime_type, d.is_private, d.download_count, d.uploaded_by, d.created_at, d.updated_at,
         s.first_name || ' ' || s.last_name AS student_name, s.student_number,
         NULLIF(concat_ws(' ', s.first_name_am, s.fathers_name_am, s.last_name_am), '') AS student_name_am,
         c.name AS class_name,
         te.first_name || ' ' || te.last_name AS teacher_name,
         ${UPLOADER} AS uploaded_by_name, u.email AS uploaded_by_email, u.role AS uploaded_by_role
  FROM documents d
  LEFT JOIN students s ON s.id = d.student_id
  LEFT JOIN classes  c ON c.id = s.class_id
  LEFT JOIN teachers te ON te.id = d.teacher_id
  LEFT JOIN users    u ON u.id = d.uploaded_by
  LEFT JOIN teachers ut ON ut.user_id = u.id`;

// Teacher: own uploads; shared documents not about a student, or about a student of own classes
const visibilityCondition = (user, params, alias = 'd') => {
  if (isSchoolWide(user)) return null;
  params.push(user.id);
  const me = `$${params.length}`;
  return `(${alias}.uploaded_by = ${me} OR (${alias}.is_private = FALSE AND (${alias}.student_id IS NULL OR EXISTS (
    SELECT 1 FROM students vs JOIN teacher_classes vtc ON vtc.class_id = vs.class_id JOIN teachers vt ON vt.id = vtc.teacher_id
    WHERE vs.id = ${alias}.student_id AND vt.user_id = ${me}))))`;
};

/** The document if this user may see it, else null */
const loadVisible = async (q, user, id) => {
  const params = [id];
  const visible = visibilityCondition(user, params);
  const { rows } = await q.query(`${SELECT} WHERE d.id = $1 ${visible ? `AND ${visible}` : ''}`, params);
  return rows[0] || null;
};

const removeFile = (file) => { if (file && fs.existsSync(file)) fs.unlinkSync(file); };
const trimOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const bool = (v, fallback) => (v === undefined || v === '' ? fallback : v === true || v === 'true');

/** title, category, description: the same rules for upload and edit. Returns an error message or null. */
const checkDetails = ({ title, category, description }, partial) => {
  if (!partial || title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) return { message: 'title is required.', field: 'title' };
    if (title.trim().length > TITLE_MAX) return { message: `title: at most ${TITLE_MAX} characters.`, field: 'title' };
  }
  if (!partial || category !== undefined) {
    if (!CATEGORY_KEYS.includes(category)) return { message: 'Invalid category.', field: 'category' };
  }
  if (description !== undefined && description !== null && typeof description !== 'string') return { message: 'description must be text.', field: 'description' };
  if (typeof description === 'string' && description.trim().length > DESCRIPTION_MAX) return { message: `description: at most ${DESCRIPTION_MAX} characters.`, field: 'description' };
  return null;
};

// POST /documents/upload (multipart: file, title, category, description, student_id, teacher_id, is_private)
const uploadDocument = async (req, res) => {
  const file = req.file?.path;
  try {
    if (!req.file) return sendError(res, 'No file uploaded.', 400);
    const { student_id, teacher_id, category, title, description } = req.body;
    const bad = checkDetails({ title, category, description }, false);
    if (bad) { removeFile(file); return sendError(res, bad.message, 400, { field: bad.field }); }
    if (!contentMatches(file, req.file.mimetype)) {
      removeFile(file);
      return sendError(res, "The file's content does not match its type.", 400, { field: 'file' });
    }
    const studentId = student_id && uuidRegex.test(student_id) ? student_id : null;
    const teacherId = teacher_id && uuidRegex.test(teacher_id) ? teacher_id : null;
    if (req.user.role === 'teacher') {
      if (studentId && !(await canAccessStudent(req.user, studentId))) {
        removeFile(file); return sendError(res, 'You can add documents only for students of your own classes.', 403);
      }
      if (teacherId && teacherId !== (await getTeacherId(req.user.id))) {
        removeFile(file); return sendError(res, 'You can add documents only to your own teacher record.', 403);
      }
    }
    const doc = await inTransaction(async (client) => {
      const { rows: [d] } = await client.query(
        `INSERT INTO documents (student_id, teacher_id, category, title, description, file_name, file_path, file_size, mime_type, is_private, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [studentId, teacherId, category, title.trim(), trimOrNull(description), req.file.originalname,
          file, req.file.size, req.file.mimetype, bool(req.body.is_private, true), req.user.id]);
      await audit(client, req, 'document.uploaded', 'document', d.id, {
        name: title.trim(), category, file_name: req.file.originalname, file_size: req.file.size,
        student_id: studentId, teacher_id: teacherId, is_private: bool(req.body.is_private, true),
      });
      return loadVisible(client, req.user, d.id);
    });
    return sendSuccess(res, doc, 'Document uploaded.', 201);
  } catch (err) {
    removeFile(file);
    return sendServerError(res, err, 'Server error.');
  }
};

// GET /documents?search=&category=&student_id=&teacher_id=&is_private=true|false&mine=true&page=&limit=
const getDocuments = async (req, res) => {
  try {
    const { student_id, teacher_id, category, is_private, mine, search = '' } = req.query;
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);
    const { page, limit, offset } = pg;
    for (const [k, v] of [['student_id', student_id], ['teacher_id', teacher_id]]) {
      if (v && !uuidRegex.test(v)) return sendError(res, `${k} must be an id.`, 400, { field: k });
    }
    if (category && !CATEGORY_KEYS.includes(category)) return sendError(res, 'Invalid category.', 400, { field: 'category' });
    const conditions = []; const params = [];
    const add = (sql, v) => { params.push(v); conditions.push(sql.replaceAll('?', `$${params.length}`)); };
    if (student_id) add('d.student_id = ?', student_id);
    if (teacher_id) add('d.teacher_id = ?', teacher_id);
    if (category) add('d.category = ?', category);
    if (is_private === 'true' || is_private === 'false') add('d.is_private = ?', is_private === 'true');
    if (mine === 'true') add('d.uploaded_by = ?', req.user.id);
    if (String(search).trim()) {
      add(`(d.title ILIKE ? OR d.description ILIKE ? OR d.file_name ILIKE ? OR s.student_number ILIKE ?
            OR (s.first_name || ' ' || s.last_name) ILIKE ? OR concat_ws(' ', s.first_name_am, s.fathers_name_am, s.last_name_am) ILIKE ?)`,
      `%${String(search).trim()}%`);
    }
    const visible = visibilityCondition(req.user, params);
    if (visible) conditions.push(visible);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(`${SELECT} ${where} ORDER BY d.created_at DESC, d.id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
    const { rows: [ct] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM documents d LEFT JOIN students s ON s.id = d.student_id ${where}`, params);
    return sendSuccess(res, {
      documents: rows,
      pagination: { total: ct.n, page, limit, totalPages: Math.ceil(ct.n / limit) },
    }, `Found ${rows.length} document(s).`);
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

const getDocumentById = async (req, res) => {
  try {
    const doc = await loadVisible(db, req.user, req.params.id);
    if (!doc) return sendError(res, 'Document not found.', 404);
    return sendSuccess(res, doc, 'Document retrieved.');
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

const downloadDocument = async (req, res) => {
  try {
    if (!(await loadVisible(db, req.user, req.params.id))) return sendError(res, 'Document not found.', 404);
    const { rows: [d] } = await db.query('SELECT id, file_name, file_path, mime_type FROM documents WHERE id = $1', [req.params.id]);
    if (!fs.existsSync(d.file_path)) return sendError(res, 'File not found.', 404);
    await db.query('UPDATE documents SET download_count = download_count + 1 WHERE id = $1', [d.id]);
    // res.attachment() writes an RFC 5987 header (filename*=UTF-8''...) with an
    // ASCII fallback, so Amharic and other non-ASCII names download correctly.
    res.attachment(d.file_name);
    if (d.mime_type) res.type(d.mime_type);
    return res.sendFile(path.resolve(d.file_path));
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

// GET /documents/student/:studentId (a teacher: only students of their own classes)
const getStudentDocuments = async (req, res) => {
  try {
    if (!(await canAccessStudent(req.user, req.params.studentId))) return sendError(res, 'Access denied.', 403);
    const params = [req.params.studentId];
    const visible = visibilityCondition(req.user, params);
    const { rows } = await db.query(
      `${SELECT} WHERE d.student_id = $1 ${visible ? `AND ${visible}` : ''} ORDER BY d.category, d.created_at DESC`, params);
    const byCategory = {};
    for (const doc of rows) (byCategory[doc.category] ||= []).push(doc);
    return sendSuccess(res, { total: rows.length, by_category: byCategory, documents: rows }, `Found ${rows.length} document(s).`);
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

// PUT /documents/:id { title, category, description, is_private } — admin, or the uploader
const updateDocument = async (req, res) => {
  try {
    const { title, category, description, is_private } = req.body;
    const bad = checkDetails({ title, category, description }, true);
    if (bad) return sendError(res, bad.message, 400, { field: bad.field });
    if (is_private !== undefined && typeof is_private !== 'boolean') return sendError(res, 'is_private must be true or false.', 400, { field: 'is_private' });
    const doc = await inTransaction(async (client) => {
      const { rows: [cur] } = await client.query(
        'SELECT id, title, category, description, is_private, uploaded_by FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!cur || !(await loadVisible(client, req.user, cur.id))) throw new DocumentError('Document not found.', 404);
      if (req.user.role !== 'admin' && cur.uploaded_by !== req.user.id) throw new DocumentError('Only an admin or the uploader can change this document.', 403);
      const next = {
        title: title === undefined ? cur.title : title.trim(),
        category: category ?? cur.category,
        description: description === undefined ? cur.description : trimOrNull(description),
        is_private: is_private ?? cur.is_private,
      };
      await client.query('UPDATE documents SET title = $2, category = $3, description = $4, is_private = $5, updated_at = NOW() WHERE id = $1',
        [cur.id, next.title, next.category, next.description, next.is_private]);
      const { uploaded_by: _u, id: _i, ...old } = cur;
      await audit(client, req, 'document.updated', 'document', cur.id, { name: next.title, ...next }, old);
      return loadVisible(client, req.user, cur.id);
    });
    return sendSuccess(res, doc, 'Document updated.');
  } catch (err) {
    if (err instanceof DocumentError) return sendError(res, err.message, err.status);
    return sendServerError(res, err, 'Server error.');
  }
};

// DELETE /documents/:id — admin. The row goes (audited) first; then the file.
const deleteDocument = async (req, res) => {
  try {
    const gone = await inTransaction(async (client) => {
      const { rows: [d] } = await client.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!d) return null;
      await client.query('DELETE FROM documents WHERE id = $1', [d.id]);
      await audit(client, req, 'document.deleted', 'document', d.id, null, {
        name: d.title, title: d.title, category: d.category, file_name: d.file_name, file_size: d.file_size,
        student_id: d.student_id, teacher_id: d.teacher_id, is_private: d.is_private, uploaded_by: d.uploaded_by,
      });
      return d;
    });
    if (!gone) return sendError(res, 'Document not found.', 404);
    try { removeFile(gone.file_path); } catch (err) { console.error('document file not removed:', gone.file_path, err.message); }
    return sendSuccess(res, null, `Document "${gone.title}" deleted.`);
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

const getCategories = async (req, res) => {
  try {
    const params = [];
    const visible = visibilityCondition(req.user, params);
    const { rows } = await db.query(
      `SELECT category, COUNT(*)::int AS count, COALESCE(SUM(file_size), 0)::bigint AS total_size
       FROM documents d ${visible ? `WHERE ${visible}` : ''} GROUP BY category`, params);
    return sendSuccess(res, CATEGORIES.map((c) => {
      const r = rows.find((x) => x.category === c.key);
      return { ...c, count: r?.count ?? 0, total_size: Number(r?.total_size ?? 0) };
    }), 'Categories retrieved.');
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

// GET /documents/limits — what may be uploaded (the screens show it before the upload)
const getLimits = (req, res) => sendSuccess(res, {
  max_bytes: MAX_BYTES, mime_types: ALLOWED_MIME, extensions: EXTENSIONS, categories: CATEGORY_KEYS,
  title_max: TITLE_MAX, description_max: DESCRIPTION_MAX,
}, 'Upload limits.');

module.exports = {
  uploadDocument, getDocuments, getDocumentById, updateDocument,
  downloadDocument, getStudentDocuments, deleteDocument, getCategories, getLimits,
};
