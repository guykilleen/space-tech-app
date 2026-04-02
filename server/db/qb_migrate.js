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
CREATE TABLE IF NOT EXISTS qb_contacts (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(120) NOT NULL,
  email      VARCHAR(200),
  company    VARCHAR(120),
  phone      VARCHAR(40),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qb_price_list (
  id         UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  category   VARCHAR(80)   NOT NULL DEFAULT 'Materials',
  product    VARCHAR(200)  NOT NULL,
  price      NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit       VARCHAR(40),
  active     BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order INTEGER       NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qb_quote_headers (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_number VARCHAR(30)   NOT NULL UNIQUE,
  date         DATE          NOT NULL DEFAULT CURRENT_DATE,
  client_id    UUID          REFERENCES qb_contacts(id) ON DELETE SET NULL,
  project      VARCHAR(200),
  prepared_by  VARCHAR(120),
  margin       NUMERIC(5,4)  NOT NULL DEFAULT 0.10,
  status       VARCHAR(30)   NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','sent','accepted','declined')),
  notes        TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qb_quote_units (
  id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id       UUID          NOT NULL REFERENCES qb_quote_headers(id) ON DELETE CASCADE,
  unit_number    INTEGER       NOT NULL,
  drawing_number VARCHAR(60),
  room_number    VARCHAR(60),
  level          VARCHAR(60),
  description    TEXT,
  quantity       NUMERIC(10,2) NOT NULL DEFAULT 1,
  sort_order     INTEGER       NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (quote_id, unit_number)
);

CREATE TABLE IF NOT EXISTS qb_quote_unit_lines (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id         UUID          NOT NULL REFERENCES qb_quote_units(id) ON DELETE CASCADE,
  price_list_id   UUID          REFERENCES qb_price_list(id) ON DELETE SET NULL,
  category        VARCHAR(80)   NOT NULL DEFAULT 'Materials',
  product         VARCHAR(200)  NOT NULL,
  price           NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit_of_measure VARCHAR(40),
  quantity        NUMERIC(10,3) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) GENERATED ALWAYS AS (price * quantity) STORED,
  sort_order      INTEGER       NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_quote_headers_status ON qb_quote_headers(status);
CREATE INDEX IF NOT EXISTS idx_qb_quote_headers_client ON qb_quote_headers(client_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_units_quote    ON qb_quote_units(quote_id);
CREATE INDEX IF NOT EXISTS idx_qb_unit_lines_unit      ON qb_quote_unit_lines(unit_id);
CREATE INDEX IF NOT EXISTS idx_qb_price_list_category  ON qb_price_list(category);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_qb_contacts_updated_at') THEN
    CREATE TRIGGER trg_qb_contacts_updated_at
      BEFORE UPDATE ON qb_contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_qb_price_list_updated_at') THEN
    CREATE TRIGGER trg_qb_price_list_updated_at
      BEFORE UPDATE ON qb_price_list FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_qb_quote_headers_updated_at') THEN
    CREATE TRIGGER trg_qb_quote_headers_updated_at
      BEFORE UPDATE ON qb_quote_headers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_qb_quote_units_updated_at') THEN
    CREATE TRIGGER trg_qb_quote_units_updated_at
      BEFORE UPDATE ON qb_quote_units FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_qb_quote_unit_lines_updated_at') THEN
    CREATE TRIGGER trg_qb_quote_unit_lines_updated_at
      BEFORE UPDATE ON qb_quote_unit_lines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
`;

async function migrate() {
  console.log('Running QB migration...');
  try {
    await pool.query(SQL);
    console.log('QB migration complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
