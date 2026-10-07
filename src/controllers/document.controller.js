const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const { sendSuccess, sendError } = require('../utils/response');
const { sendServerError } = require('../utils/errors');
const { isSchoolWide }    = require('../utils/scope');
const { parsePagination } = require('../utils/pagination');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Private documents: visible to admins, the principal and the uploader ──
// is_private is nullable in existing databases; NULL is treated as private.
const canSeeDocument = (user, doc) =>
  isSchoolWide(user) || doc.is_private === false || doc.uploaded_by === user.id;

// SQL condition for list queries. Pushes the user id onto params when needed.
const visibilityCondition = (user, params, alias = 'd') => {
  if (isSchoolWide(user)) return null;
  params.push(user.id);
  return `(COALESCE(${alias}.is_private, TRUE) = FALSE OR ${alias}.uploaded_by = $${params.length})`;
};

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uploadDocument = async (req, res) => {
  try {
    const { student_id, teacher_id, category, title, description, is_private = true } = req.body;
    if (!req.file) return sendError(res, 'No file uploaded.', 400);
    if (!category || !title) {
      fs.unlinkSync(req.file.path);
      return sendError(res, 'category and title are required.', 400);
    }
    const valid = ['id_document','birth_certificate','transcript','medical',
                   'photo','letter','certificate','report','other'];
    if (!valid.includes(category)) {
      fs.unlinkSync(req.file.path);
      return sendError(res, 'Invalid category.', 400);
    }
    const studentId = student_id && uuidRegex.test(student_id) ? student_id : null;
    const teacherId = teacher_id && uuidRegex.test(teacher_id) ? teacher_id : null;
    const { rows } = await db.query(
      `INSERT INTO documents
         (student_id,teacher_id,category,title,description,
          file_name,file_path,file_size,mime_type,is_private,uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [studentId, teacherId, category, title.trim(),
       description?.trim()||null, req.file.originalname,
       req.file.path, req.file.size, req.file.mimetype,
       is_private==='true'||is_private===true, req.user.id]
    );
    return sendSuccess(res, rows[0], 'Document uploaded.', 201);
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return sendServerError(res, err, 'Server error.');
  }
};

const getDocuments = async (req, res) => {
  try {
    const { student_id, teacher_id, category, search='' } = req.query;
    const pg = parsePagination(req.query);
    if (pg.error) return sendError(res, pg.error, 400);
    const { page, limit, offset } = pg;
    const conditions=[]; const params=[]; let idx=1;
    if (student_id) { conditions.push(`d.student_id=$${idx++}`); params.push(student_id); }
    if (teacher_id) { conditions.push(`d.teacher_id=$${idx++}`); params.push(teacher_id); }
    if (category)   { conditions.push(`d.category=$${idx++}`); params.push(category); }
    if (search.trim()) {
      conditions.push(`(d.title ILIKE $${idx} OR d.description ILIKE $${idx})`);
      params.push(`%${search.trim()}%`); idx++;
    }
    const visible = visibilityCondition(req.user, params);
    if (visible) { conditions.push(visible); idx++; }
    const where = conditions.length ? 'WHERE '+conditions.join(' AND ') : '';
    const { rows } = await db.query(
      `SELECT d.*, s.first_name||' '||s.last_name AS student_name,
         s.student_number, u.email AS uploaded_by_email
       FROM documents d
       LEFT JOIN students s ON s.id=d.student_id
       LEFT JOIN users    u ON u.id=d.uploaded_by
       ${where} ORDER BY d.created_at DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, parseInt(limit), offset]
    );
    const ct = await db.query(`SELECT COUNT(*) FROM documents d ${where}`, params);
    return sendSuccess(res, {
      documents: rows,
      pagination: {
        total: parseInt(ct.rows[0].count), page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(parseInt(ct.rows[0].count)/parseInt(limit)),
      },
    }, `Found ${rows.length} document(s).`);
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

const getDocumentById = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT d.*, s.first_name||' '||s.last_name AS student_name,
         s.student_number, u.email AS uploaded_by_email
       FROM documents d
       LEFT JOIN students s ON s.id=d.student_id
       LEFT JOIN users    u ON u.id=d.uploaded_by
       WHERE d.id=$1`, [req.params.id]
    );
    if (!rows[0] || !canSeeDocument(req.user, rows[0])) {
      return sendError(res, 'Document not found.', 404);
    }
    return sendSuccess(res, rows[0], 'Document retrieved.');
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

const downloadDocument = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
    if (!rows[0] || !canSeeDocument(req.user, rows[0])) {
      return sendError(res, 'Document not found.', 404);
    }
    if (!fs.existsSync(rows[0].file_path)) return sendError(res, 'File not found.', 404);
    await db.query('UPDATE documents SET download_count=download_count+1 WHERE id=$1', [rows[0].id]);
    // res.attachment() writes an RFC 5987 header (filename*=UTF-8''...) with an
    // ASCII fallback, so Amharic and other non-ASCII names download correctly.
    res.attachment(rows[0].file_name);
    if (rows[0].mime_type) res.type(rows[0].mime_type);
    res.sendFile(path.resolve(rows[0].file_path));
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

const getStudentDocuments = async (req, res) => {
  try {
    const params  = [req.params.studentId];
    const visible = visibilityCondition(req.user, params);
    const { rows } = await db.query(
      `SELECT d.*, u.email AS uploaded_by_email FROM documents d
       LEFT JOIN users u ON u.id=d.uploaded_by
       WHERE d.student_id=$1 ${visible ? 'AND ' + visible : ''}
       ORDER BY d.category, d.created_at DESC`,
      params
    );
    const byCategory = {};
    rows.forEach(doc => {
      if (!byCategory[doc.category]) byCategory[doc.category]=[];
      byCategory[doc.category].push(doc);
    });
    return sendSuccess(res, { total:rows.length, by_category:byCategory, documents:rows },
      `Found ${rows.length} document(s).`);
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

const deleteDocument = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
    if (!rows[0]) return sendError(res, 'Document not found.', 404);
    if (fs.existsSync(rows[0].file_path)) fs.unlinkSync(rows[0].file_path);
    await db.query('DELETE FROM documents WHERE id=$1', [req.params.id]);
    return sendSuccess(res, null, `Document "${rows[0].title}" deleted.`);
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

const getCategories = async (req, res) => {
  try {
    const params  = [];
    const visible = visibilityCondition(req.user, params);
    const { rows } = await db.query(
      `SELECT category, COUNT(*) AS count, SUM(file_size) AS total_size
       FROM documents d ${visible ? 'WHERE ' + visible : ''}
       GROUP BY category ORDER BY count DESC`,
      params
    );
    const cats = [
      {key:'id_document',label:'ID Document',icon:'🪪'},
      {key:'birth_certificate',label:'Birth Certificate',icon:'📋'},
      {key:'transcript',label:'Transcript',icon:'📄'},
      {key:'medical',label:'Medical Record',icon:'🏥'},
      {key:'photo',label:'Photo',icon:'📷'},
      {key:'letter',label:'Letter',icon:'✉️'},
      {key:'certificate',label:'Certificate',icon:'🏆'},
      {key:'report',label:'Report',icon:'📊'},
      {key:'other',label:'Other',icon:'📁'},
    ];
    return sendSuccess(res,
      cats.map(c => ({
        ...c,
        count: parseInt(rows.find(r=>r.category===c.key)?.count||0),
        total_size: parseInt(rows.find(r=>r.category===c.key)?.total_size||0),
      })), 'Categories retrieved.');
  } catch (err) { return sendServerError(res, err, 'Server error.'); }
};

module.exports = {
  uploadDocument, getDocuments, getDocumentById,
  downloadDocument, getStudentDocuments, deleteDocument, getCategories,
};