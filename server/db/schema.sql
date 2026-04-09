-- Space Tech Design Pty Ltd — Database Schema (v2)
-- Matches joinery-tracker.html data model

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS
-- Roles: admin, manager, workshop, readonly
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    role        VARCHAR(20)  NOT NULL CHECK (role IN ('admin','manager','workshop','readonly')),
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- QUOTES
-- Status: pending, review, accepted, declined
-- VQ-prefix = variation quote (creates sub-job under parent)
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_number    VARCHAR(30) NOT NULL UNIQUE,   -- e.g. Q-001, VQ-001
    initials        VARCHAR(10),                   -- preparer's initials
    date            DATE,
    client_name     VARCHAR(150) NOT NULL,
    project         VARCHAR(255),                  -- project title/description
    value           NUMERIC(12,2) NOT NULL DEFAULT 0,  -- excl. GST
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','review','accepted','declined')),
    accept_details  VARCHAR(255),                  -- PO number, verbal, email ref...
    accept_date     DATE,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- JOBS
-- job_number is a string e.g. "48", "48_1" (sub-job/variation)
-- Hours per phase drive the Gantt bars (8 hrs = 1 workday)
-- WIP data is embedded: wip_start, wip_due, wip_complete, wip_completed
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_number      VARCHAR(30) NOT NULL UNIQUE,   -- e.g. "48", "48_1"
    quote_id        UUID        REFERENCES quotes(id) ON DELETE SET NULL,
    quote_number    VARCHAR(30),                   -- denormalised for display
    parent_job_id   UUID        REFERENCES jobs(id) ON DELETE SET NULL,  -- for sub-jobs
    client_name     VARCHAR(150) NOT NULL,
    project         VARCHAR(255),
    -- Hours per phase
    hours_admin     NUMERIC(8,1) NOT NULL DEFAULT 0,
    hours_machining NUMERIC(8,1) NOT NULL DEFAULT 0,
    hours_assembly  NUMERIC(8,1) NOT NULL DEFAULT 0,
    hours_delivery  NUMERIC(8,1) NOT NULL DEFAULT 0,
    hours_install   NUMERIC(8,1) NOT NULL DEFAULT 0,
    total_hours     NUMERIC(8,1) GENERATED ALWAYS AS
                        (hours_admin + hours_machining + hours_assembly + hours_delivery + hours_install)
                        STORED,
    -- WIP scheduling
    wip_start       DATE,        -- job start date (falls back to quote accept_date)
    wip_due         DATE,        -- due on-site
    wip_complete    SMALLINT    NOT NULL DEFAULT 0 CHECK (wip_complete BETWEEN 0 AND 100),
    wip_completed   BOOLEAN     NOT NULL DEFAULT FALSE,
    notes           TEXT,
    created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_quotes_status     ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_jobs_quote_id     ON jobs(quote_id);
CREATE INDEX IF NOT EXISTS idx_jobs_parent       ON jobs(parent_job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_wip_due      ON jobs(wip_due);
CREATE INDEX IF NOT EXISTS idx_jobs_completed    ON jobs(wip_completed);

-- ============================================================
-- AUTO-UPDATE updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_users_updated_at')  THEN
    CREATE TRIGGER trg_users_updated_at  BEFORE UPDATE ON users  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_quotes_updated_at') THEN
    CREATE TRIGGER trg_quotes_updated_at BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_jobs_updated_at')   THEN
    CREATE TRIGGER trg_jobs_updated_at   BEFORE UPDATE ON jobs   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF;
END $$;
