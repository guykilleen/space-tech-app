require('dotenv').config();
const pool = require('../config/db');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Migrate existing data
    await client.query(`UPDATE quotes SET status = 'draft' WHERE status = 'pending'`);
    await client.query(`UPDATE quotes SET status = 'sent'  WHERE status = 'review'`);
    await client.query(`UPDATE quotes SET status = 'sent'  WHERE status = 'declined'`);

    // Drop old CHECK constraint (name may vary — drop by scanning pg_constraint)
    const { rows } = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'quotes'::regclass AND contype = 'c' AND conname ILIKE '%status%'
    `);
    for (const r of rows) {
      await client.query(`ALTER TABLE quotes DROP CONSTRAINT "${r.conname}"`);
    }

    // Add new CHECK constraint
    await client.query(`
      ALTER TABLE quotes
      ADD CONSTRAINT quotes_status_check CHECK (status IN ('draft', 'sent', 'accepted'))
    `);

    await client.query('COMMIT');
    console.log('migrate_quotes_status_simplify: done');
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
