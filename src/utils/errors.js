// src/utils/errors.js
// ============================================================
// Unexpected (500) errors: the client gets a generic message plus a
// short error id; the full error is logged server-side under that id,
// so a user's screenshot can be matched to the log line.
//
// Usage (inside a catch block):
//   return sendServerError(res, err, 'Server error while fetching students.');
// ============================================================

const crypto        = require('crypto');
const { sendError } = require('./response');

const sendServerError = (res, err, message = 'Server error.') => {
  const errorId = crypto.randomBytes(4).toString('hex');
  const where   = res.req ? `${res.req.method} ${res.req.originalUrl}` : '';
  console.error(`[error ${errorId}] ${where} — ${message}\n`, err);
  return sendError(res, `${message} (ref: ${errorId})`, 500, { error_id: errorId });
};

module.exports = { sendServerError };
