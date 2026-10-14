// src/routes/document.routes.js
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const {
  uploadDocument, getDocuments, getDocumentById,
  downloadDocument, getStudentDocuments, deleteDocument, getCategories,
} = require('../controllers/document.controller');
const { authenticate }              = require('../middleware/auth.middleware');
const { adminOnly, allStaff }       = require('../middleware/role.middleware');
const { validateIds } = require('../middleware/validateIds.middleware');
const { validateBodyIds } = require('../middleware/validateBodyIds.middleware');
const { sendError } = require('../utils/response');

// Multer config
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random()*1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf','image/jpeg','image/png','image/jpg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  allowed.includes(file.mimetype) ? cb(null,true)
    : cb(new Error('File type not allowed. Use PDF, JPG, PNG, DOC, DOCX, XLS, XLSX.'), false);
};

// defParamCharset: decode upload filenames as UTF-8 (multer's default, latin1,
// garbles Amharic and other non-ASCII names)
const upload = multer({ storage, fileFilter, defParamCharset: 'utf8',
                        limits:{ fileSize: 10*1024*1024 } });

// A refused file (type, size) is the client's mistake: 400 / 413, not 500
const uploadFile = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 'The file is larger than 10 MB.', 413);
  return sendError(res, err.message, 400);
});

// Routes
router.use(authenticate);

const checkIds = validateIds({ id: 'documents' });   // malformed/unknown ids -> 404 (after role + access checks)
// Admin + principal: all documents; teacher: own uploads + public (see controller)
router.get('/categories',          allStaff, getCategories);
router.get('/student/:studentId',  allStaff, checkIds, getStudentDocuments);
router.get('/download/:id',        allStaff, checkIds, downloadDocument);
router.get('/:id',                 allStaff, checkIds, getDocumentById);
router.get('/',                    allStaff, getDocuments);
router.post('/upload', allStaff, uploadFile,
  validateBodyIds({ student_id: 'students', teacher_id: 'teachers' }), uploadDocument);
router.delete('/:id',              adminOnly, checkIds, deleteDocument);

module.exports = router;
