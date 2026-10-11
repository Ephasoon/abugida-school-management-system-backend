// Guarded helper: only ever connects to asms_phase0_test.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const NAME = 'asms_phase0_test';
if (process.env.DB_NAME !== NAME) { console.error('[tdb] ABORT: DB_NAME is', process.env.DB_NAME); process.exit(1); }
const pool = new Pool({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: NAME });
module.exports = pool;
