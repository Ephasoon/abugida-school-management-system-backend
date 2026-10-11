// Test-only: set a user's password in the scratch DB. Usage: node setpw.js <email> <password>
const pool = require('./tdb');
const bcrypt = require('bcryptjs');
(async () => {
  const db = (await pool.query('select current_database() d')).rows[0].d;
  const r = await pool.query('UPDATE users SET password_hash=$2 WHERE email=$1 RETURNING email', [process.argv[2], bcrypt.hashSync(process.argv[3], 4)]);
  console.log(`[setpw] ${db}: updated ${r.rowCount} user(s)`); await pool.end();
})();
