// The test server's upload folder (tests/guard.sh sets UPLOAD_DIR to the same place).
const path = require('path');
const fs = require('fs');
const DIR = path.join(__dirname, 'uploads', 'documents');
fs.mkdirSync(DIR, { recursive: true });
module.exports = DIR;
