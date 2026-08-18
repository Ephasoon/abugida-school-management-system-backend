// src/config/db.js
// This file creates our connection to the PostgreSQL database.
// We use the 'pg' library (already installed) which lets Node.js talk to PostgreSQL.

const { Pool } = require('pg');
require('dotenv').config();

// A "Pool" is a group of reusable database connections.
// Instead of opening/closing a connection on every request (slow),
// we keep a pool of connections ready to use (fast).
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Test the connection when the server starts.
// If something is wrong (wrong password, DB not running), we'll know immediately.
pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    console.log('✅ Connected to PostgreSQL database:', process.env.DB_NAME);
  }
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err.message);
  process.exit(1); // Stop the server — no point running without a database
});

// We export two things:
//   pool.query  → run a SQL query (most common)
//   pool        → the raw pool (for transactions)
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
