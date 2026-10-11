// Mint an access token for a user id using the backend's own signer. Usage: node token.js <userId>
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('./tdb');
const { generateAccessToken } = require('../src/utils/jwt');
pool.query('SELECT id,email,role FROM users WHERE id::text=$1 OR email=$1', [process.argv[2]])
  .then(r => { process.stdout.write(generateAccessToken(r.rows[0])); return pool.end(); });
