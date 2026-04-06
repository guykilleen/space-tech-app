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

const SQL = `
-- Link QB quote headers to the Job Tracker quotes table
ALTER TABLE qb_quote_headers
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE;

-- Enforce one QB header per job-tracker quote (NULLs excluded so standalone QB quotes still work)
CREATE UNIQUE INDEX IF NOT EXISTS idx_qb_quote_headers_quote_id
  ON qb_quote_headers(quote_id) WHERE quote_id IS NOT NULL;
`;

async function migrate() {
  console.log('Linking qb_quote_headers → quotes...');
  try {
    await pool.query(SQL);
    console.log('Done.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
