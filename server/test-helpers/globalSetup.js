// Runs once before all test suites.
// Creates the test database if needed, applies schema, seeds test users.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

const { Client } = require('pg');
const bcrypt     = require('bcryptjs');

const TEST_DB = process.env.DB_NAME || 'space_tech_design_test';
const BASE    = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
};

// Minimal schema matching production (IF NOT EXISTS so re-runs are safe)
const SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  CREATE TABLE IF NOT EXISTS users (
    id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(120) NOT NULL,
    email      VARCHAR(200) UNIQUE NOT NULL,
    password   VARCHAR(200) NOT NULL,
    role       VARCHAR(20)  NOT NULL DEFAULT 'readonly',
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id             UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_number   VARCHAR(30)   UNIQUE,
    initials       VARCHAR(10),
    date           DATE,
    client_name    VARCHAR(200)  NOT NULL,
    project        VARCHAR(200),
    value          NUMERIC(12,2) DEFAULT 0,
    status         VARCHAR(30)   NOT NULL DEFAULT 'pending',
    accept_details VARCHAR(200),
    accept_date    DATE,
    created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS qb_contacts (
    id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_number VARCHAR(30)  NOT NULL UNIQUE,
    date         DATE         NOT NULL DEFAULT CURRENT_DATE,
    client_id    UUID         REFERENCES qb_contacts(id) ON DELETE SET NULL,
    project      VARCHAR(200),
    prepared_by  VARCHAR(120),
    margin       NUMERIC(5,4) NOT NULL DEFAULT 0.15,
    waste_pct    NUMERIC(5,4) NOT NULL DEFAULT 0.10,
    status       VARCHAR(30)  NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','accepted','declined')),
    notes        TEXT,
    quote_id     UUID         REFERENCES quotes(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_qb_quote_headers_quote_id
    ON qb_quote_headers(quote_id) WHERE quote_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS qb_quote_units (
    id                           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id                     UUID          NOT NULL REFERENCES qb_quote_headers(id) ON DELETE CASCADE,
    unit_number                  INTEGER       NOT NULL,
    drawing_number               VARCHAR(60),
    room_number                  VARCHAR(60),
    level                        VARCHAR(60),
    description                  TEXT,
    quantity                     NUMERIC(10,2) NOT NULL DEFAULT 1,
    sort_order                   INTEGER       NOT NULL DEFAULT 0,
    admin_hours                  NUMERIC(8,2)  NOT NULL DEFAULT 0,
    cnc_hours                    NUMERIC(8,2)  NOT NULL DEFAULT 0,
    edgebander_hours             NUMERIC(8,2)  NOT NULL DEFAULT 0,
    assembly_hours               NUMERIC(8,2)  NOT NULL DEFAULT 0,
    delivery_hours               NUMERIC(8,2)  NOT NULL DEFAULT 0,
    installation_hours           NUMERIC(8,2)  NOT NULL DEFAULT 0,
    admin_rate                   NUMERIC(10,2) NOT NULL DEFAULT 100,
    cnc_rate                     NUMERIC(10,2) NOT NULL DEFAULT 100,
    edgebander_rate              NUMERIC(10,2) NOT NULL DEFAULT 100,
    assembly_rate                NUMERIC(10,2) NOT NULL DEFAULT 100,
    delivery_rate                NUMERIC(10,2) NOT NULL DEFAULT 100,
    installation_rate            NUMERIC(10,2) NOT NULL DEFAULT 100,
    admin_rate_overridden        BOOLEAN       NOT NULL DEFAULT FALSE,
    cnc_rate_overridden          BOOLEAN       NOT NULL DEFAULT FALSE,
    edgebander_rate_overridden   BOOLEAN       NOT NULL DEFAULT FALSE,
    assembly_rate_overridden     BOOLEAN       NOT NULL DEFAULT FALSE,
    delivery_rate_overridden     BOOLEAN       NOT NULL DEFAULT FALSE,
    installation_rate_overridden BOOLEAN       NOT NULL DEFAULT FALSE,
    rates_last_synced_at         TIMESTAMPTZ,
    created_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (quote_id, unit_number)
  );

  CREATE TABLE IF NOT EXISTS qb_quote_unit_lines (
    id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id          UUID          NOT NULL REFERENCES qb_quote_units(id) ON DELETE CASCADE,
    price_list_id    UUID          REFERENCES qb_price_list(id) ON DELETE SET NULL,
    category         VARCHAR(80)   NOT NULL DEFAULT 'Materials',
    product          VARCHAR(200)  NOT NULL,
    price            NUMERIC(10,2) NOT NULL DEFAULT 0,
    unit_of_measure  VARCHAR(40),
    quantity         NUMERIC(10,3) NOT NULL DEFAULT 0,
    total            NUMERIC(12,2) GENERATED ALWAYS AS (price * quantity) STORED,
    sort_order       INTEGER       NOT NULL DEFAULT 0,
    price_overridden BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS labour_rates (
    id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    type        VARCHAR(30)   NOT NULL UNIQUE
                  CHECK (type IN ('admin','cnc','edgebander','assembly','delivery','installation')),
    hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 100,
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_number          VARCHAR(30) UNIQUE,
    quote_id            UUID        REFERENCES quotes(id) ON DELETE SET NULL,
    quote_number        VARCHAR(30),
    parent_job_id       UUID        REFERENCES jobs(id)   ON DELETE SET NULL,
    client_name         VARCHAR(200),
    project             VARCHAR(200),
    hours_admin         NUMERIC(8,2) DEFAULT 0,
    hours_machining     NUMERIC(8,2) DEFAULT 0,
    hours_assembly      NUMERIC(8,2) DEFAULT 0,
    hours_delivery      NUMERIC(8,2) DEFAULT 0,
    hours_install       NUMERIC(8,2) DEFAULT 0,
    total_hours         NUMERIC(8,2),
    wip_start           DATE,
    wip_due             DATE,
    wip_complete        SMALLINT    DEFAULT 0,
    wip_completed       BOOLEAN     DEFAULT FALSE,
    wip_hours_admin     NUMERIC(8,2) DEFAULT 0,
    wip_hours_machining NUMERIC(8,2) DEFAULT 0,
    wip_hours_assembly  NUMERIC(8,2) DEFAULT 0,
    wip_hours_delivery  NUMERIC(8,2) DEFAULT 0,
    wip_hours_install   NUMERIC(8,2) DEFAULT 0,
    created_by          UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

module.exports = async function () {
  // 1. Create test DB if it doesn't exist
  const admin = new Client({ ...BASE, database: 'postgres' });
  await admin.connect();
  const { rows } = await admin.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`, [TEST_DB]
  );
  if (!rows.length) {
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  }
  await admin.end();

  // 2. Apply schema
  const db = new Client({ ...BASE, database: TEST_DB });
  await db.connect();
  await db.query(SCHEMA);

  // 3. Seed fixed test users (ON CONFLICT DO NOTHING = idempotent)
  const hash = await bcrypt.hash('testpass123', 10);
  await db.query(`
    INSERT INTO users (name, email, password, role) VALUES
      ('Test Admin',    'admin@test.local',    $1, 'admin'),
      ('Test Manager',  'manager@test.local',  $1, 'manager'),
      ('Test Workshop', 'workshop@test.local', $1, 'workshop'),
      ('Test Readonly', 'readonly@test.local', $1, 'readonly')
    ON CONFLICT (email) DO NOTHING
  `, [hash]);

  // 4. Seed labour rates (idempotent)
  await db.query(`
    INSERT INTO labour_rates (type, hourly_rate) VALUES
      ('admin', 100), ('cnc', 100), ('edgebander', 100),
      ('assembly', 100), ('delivery', 100), ('installation', 100)
    ON CONFLICT (type) DO NOTHING
  `);

  await db.end();
};
