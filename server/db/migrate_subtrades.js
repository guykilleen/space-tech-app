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
-- Subtrade rows: one row per (unit, type) — UNIQUE constraint enforces at most one per type
CREATE TABLE IF NOT EXISTS qb_unit_subtrades (
  id       UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id  UUID          NOT NULL REFERENCES qb_quote_units(id) ON DELETE CASCADE,
  type     VARCHAR(30)   NOT NULL
             CHECK (type IN ('2pac_flat','2pac_recessed','stone','upholstery','glass','steel')),
  mode     VARCHAR(10)   NOT NULL DEFAULT 'fixed'
             CHECK (mode IN ('fixed','qty_rate')),
  cost     NUMERIC(10,2) NOT NULL DEFAULT 0,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
  rate     NUMERIC(10,2) NOT NULL DEFAULT 0,
  UNIQUE (unit_id, type)
);

CREATE INDEX IF NOT EXISTS idx_qb_unit_subtrades_unit ON qb_unit_subtrades(unit_id);

-- Per-unit subtrade margin (separate from the main quote margin)
ALTER TABLE qb_quote_units
  ADD COLUMN IF NOT EXISTS subtrade_margin NUMERIC(5,4) NOT NULL DEFAULT 0;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('✓ qb_unit_subtrades table created (or already existed)');
    console.log('✓ qb_quote_units.subtrade_margin column added (or already existed)');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
