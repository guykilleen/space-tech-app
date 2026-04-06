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
-- Central labour rates table (one row per type)
CREATE TABLE IF NOT EXISTS labour_rates (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        VARCHAR(30)   NOT NULL UNIQUE
                CHECK (type IN ('admin','cnc','edgebander','assembly','delivery','installation')),
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 100,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Seed default rates (idempotent)
INSERT INTO labour_rates (type, hourly_rate) VALUES
  ('admin',        100),
  ('cnc',          100),
  ('edgebander',   100),
  ('assembly',     100),
  ('delivery',     100),
  ('installation', 100)
ON CONFLICT (type) DO NOTHING;

-- New hours columns for delivery and installation
ALTER TABLE qb_quote_units
  ADD COLUMN IF NOT EXISTS delivery_hours     NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installation_hours NUMERIC(8,2) NOT NULL DEFAULT 0;

-- Rate snapshot columns — locked at unit creation time so old quotes don't change
ALTER TABLE qb_quote_units
  ADD COLUMN IF NOT EXISTS admin_rate         NUMERIC(10,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS cnc_rate           NUMERIC(10,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS edgebander_rate    NUMERIC(10,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS assembly_rate      NUMERIC(10,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS delivery_rate      NUMERIC(10,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS installation_rate  NUMERIC(10,2) NOT NULL DEFAULT 100;
`;

async function migrate() {
  console.log('Adding labour rates table and delivery/installation columns...');
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
