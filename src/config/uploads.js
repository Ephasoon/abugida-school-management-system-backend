// src/config/uploads.js
// Where uploaded documents live, and what may be uploaded (M9). UPLOAD_DIR overrides the
// folder (the test server uses tests/uploads/documents, never the school's folder).
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'documents'));
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 10 * 1024 * 1024;

// The declared type, its file name endings, and the first bytes a real file of that type has.
// DOCX/XLSX are zip files; DOC/XLS are OLE compound files.
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const TYPES = [
  { mime: 'application/pdf', ext: ['.pdf'], magic: [[0x25, 0x50, 0x44, 0x46]] },                 // %PDF
  { mime: 'image/jpeg', ext: ['.jpg', '.jpeg'], magic: [[0xff, 0xd8, 0xff]] },
  { mime: 'image/jpg', ext: ['.jpg', '.jpeg'], magic: [[0xff, 0xd8, 0xff]] },
  { mime: 'image/png', ext: ['.png'], magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  { mime: 'application/msword', ext: ['.doc'], magic: [OLE] },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: ['.docx'], magic: [ZIP] },
  { mime: 'application/vnd.ms-excel', ext: ['.xls'], magic: [OLE] },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: ['.xlsx'], magic: [ZIP] },
];
const ALLOWED_MIME = TYPES.map((t) => t.mime);
const EXTENSIONS = [...new Set(TYPES.flatMap((t) => t.ext))];

/** Does the file on disk start like the type it was declared as? */
const contentMatches = (filePath, mime) => {
  const type = TYPES.find((t) => t.mime === mime);
  if (!type) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(8);
    const n = fs.readSync(fd, head, 0, 8, 0);
    return type.magic.some((m) => n >= m.length && m.every((b, i) => head[i] === b));
  } finally {
    fs.closeSync(fd);
  }
};

module.exports = { UPLOAD_DIR, MAX_BYTES, ALLOWED_MIME, EXTENSIONS, contentMatches };
