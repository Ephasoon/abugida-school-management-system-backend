// g3 helper: sends a real database error through sendServerError and prints "STATUS body".
// The full error is logged to stderr. Run via guard.sh (scratch DB only).
const pool = require('./tdb');
const { sendServerError } = require('../src/utils/errors');
const res = { req: { method: 'GET', originalUrl: '/api/students/not-a-uuid' },
  status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
pool.query('SELECT $1::uuid', ['not-a-uuid'])
  .catch(err => sendServerError(res, err, 'Server error while fetching student.'))
  .then(() => { console.log(`${res.code} ${JSON.stringify(res.body)}`); return pool.end(); });
