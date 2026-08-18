// src/db/migrate.js
// ============================================================
// This script reads all .sql files in the migrations folder
// and runs them against your PostgreSQL database — in order.
//
// Run it with:   node src/db/migrate.js
// ============================================================

const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log('\n🚀 ASMS Database Migration Starting...\n');
    console.log(`📦 Database : ${process.env.DB_NAME}`);
    console.log(`🖥  Host     : ${process.env.DB_HOST}:${process.env.DB_PORT}\n`);
    console.log('─'.repeat(50));

    // Create a migrations tracking table if it doesn't exist.
    // This records which migrations have already run,
    // so we never run the same migration twice.
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL    PRIMARY KEY,
        filename   VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Read all .sql files from the migrations folder, sorted by name (001, 002, ...)
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Alphabetical = numerical order because of 001_, 002_ prefix

    let applied = 0;
    let skipped = 0;

    for (const file of files) {
      // Check if this migration was already applied
      const { rows } = await client.query(
        'SELECT id FROM _migrations WHERE filename = $1',
        [file]
      );

      if (rows.length > 0) {
        console.log(`⏭  SKIP     ${file} (already applied)`);
        skipped++;
        continue;
      }

      // Read the SQL file content
      const sqlPath = path.join(migrationsDir, file);
      const sql     = fs.readFileSync(sqlPath, 'utf8');

      try {
        // Run the entire migration inside a transaction.
        // If anything fails, the whole migration rolls back — no partial state.
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');

        console.log(`✅ APPLIED  ${file}`);
        applied++;

      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`\n❌ FAILED   ${file}`);
        console.error(`   Error: ${err.message}\n`);
        throw err; // Stop — don't run remaining migrations if one fails
      }
    }

    console.log('─'.repeat(50));
    console.log(`\n✨ Migration complete!`);
    console.log(`   Applied : ${applied} migration(s)`);
    console.log(`   Skipped : ${skipped} migration(s) (already run)`);
    console.log('\n📋 Your ASMS database is ready.\n');

  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('\n💥 Migration failed:', err.message);
  process.exit(1);
});
