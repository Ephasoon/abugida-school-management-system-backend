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
const { adminOnly, teacherOrAdmin } = require('../middleware/role.middleware');

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

const upload = multer({ storage, fileFilter, limits:{ fileSize: 10*1024*1024 } });

// Routes
router.use(authenticate);
router.get('/categories',          teacherOrAdmin, getCategories);
router.get('/student/:studentId',  teacherOrAdmin, getStudentDocuments);
router.get('/download/:id',        teacherOrAdmin, downloadDocument);
router.get('/:id',                 teacherOrAdmin, getDocumentById);
router.get('/',                    teacherOrAdmin, getDocuments);
router.post('/upload', teacherOrAdmin, upload.single('file'), uploadDocument);
router.delete('/:id',              adminOnly,      deleteDocument);

module.exports = router;
