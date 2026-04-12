require('dotenv').config();
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     process.env.DB_PORT     || 5432,
      database: process.env.DB_NAME     || 'space_tech_design',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
    });

async function migrate() {
  console.log('Adding revision columns to qb_quote_headers…');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Self-referential FK: revisions point to their root/parent quote
    await client.query(`
      ALTER TABLE qb_quote_headers
        ADD COLUMN IF NOT EXISTS parent_quote_id UUID
          REFERENCES qb_quote_headers(id) ON DELETE SET NULL;
    `);

    // e.g. 'A', 'B' — null for the original quote
    await client.query(`
      ALTER TABLE qb_quote_headers
        ADD COLUMN IF NOT EXISTS revision_suffix VARCHAR(10);
    `);

    // 0 = original, 1 = Rev_A, 2 = Rev_B, etc.
    await client.query(`
      ALTER TABLE qb_quote_headers
        ADD COLUMN IF NOT EXISTS revision_sequence INTEGER NOT NULL DEFAULT 0;
    `);

    // Extend status CHECK to include 'submitted' and 'locked'.
    // 'sent' and 'declined' kept for backward compatibility with existing rows.
    await client.query(`
      ALTER TABLE qb_quote_headers
        DROP CONSTRAINT IF EXISTS qb_quote_headers_status_check;
    `);
    await client.query(`
      ALTER TABLE qb_quote_headers
        ADD CONSTRAINT qb_quote_headers_status_check
        CHECK (status IN ('draft','sent','submitted','accepted','declined','locked'));
    `);

    // Index to find all revisions of a root quote quickly
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_qb_quote_headers_parent
        ON qb_quote_headers(parent_quote_id);
    `);

    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
