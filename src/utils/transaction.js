// src/utils/transaction.js
// Runs fn(client) in one transaction: COMMIT on success, ROLLBACK if it throws.

const db = require('../config/db');

const inTransaction = async (fn) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { inTransaction };
