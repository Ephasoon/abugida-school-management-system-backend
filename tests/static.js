// Test-only static server for C:\asms\asms-frontend on :5500.
// config.js is served with port 3000 -> 3100 so pages talk to the scratch-DB backend.
// The file on disk is never modified.
const http = require('http');
const fs = require('fs');
const path = require('path');
// Frontend checkout: FRONTEND_DIR, or the asms-frontend folder next to this repo
const ROOT = process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'asms-frontend');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, urlPath === '/' ? 'login.html' : urlPath);
  if (!file.startsWith(path.resolve(ROOT)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  let body = fs.readFileSync(file);
  if (urlPath === '/assets/js/config.js') body = Buffer.from(body.toString().replace(':3000/api', ':3100/api'));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(Number(process.env.STATIC_PORT || 5599), () => { fs.writeFileSync(path.join(__dirname, 'static.winpid'), String(process.pid)); console.log('static on', process.env.STATIC_PORT || 5599); });
