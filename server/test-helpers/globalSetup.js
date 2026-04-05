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

  await db.end();
};
