require('dotenv').config();
const pool = require('../config/db');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Migrate existing data
    await client.query(`UPDATE qb_quote_headers SET status = 'sent'     WHERE status = 'submitted'`);
    await client.query(`UPDATE qb_quote_headers SET status = 'sent'     WHERE status = 'declined'`);
    await client.query(`UPDATE qb_quote_headers SET status = 'accepted' WHERE status = 'locked'`);

    // Drop old CHECK constraint
    const { rows } = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'qb_quote_headers'::regclass AND contype = 'c' AND conname ILIKE '%status%'
    `);
    for (const r of rows) {
      await client.query(`ALTER TABLE qb_quote_headers DROP CONSTRAINT "${r.conname}"`);
    }

    // Add new CHECK constraint
    await client.query(`
      ALTER TABLE qb_quote_headers
      ADD CONSTRAINT qb_quote_headers_status_check CHECK (status IN ('draft', 'sent', 'accepted'))
    `);

    await client.query('COMMIT');
    console.log('migrate_qb_status_simplify: done');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
