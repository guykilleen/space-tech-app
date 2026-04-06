const pool = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Adding rate override tracking columns...');

    // Per material/hardware line: was the price manually overridden?
    await client.query(`
      ALTER TABLE qb_quote_unit_lines
        ADD COLUMN IF NOT EXISTS price_overridden BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Per unit: was each labour rate manually overridden?
    await client.query(`
      ALTER TABLE qb_quote_units
        ADD COLUMN IF NOT EXISTS admin_rate_overridden        BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS cnc_rate_overridden          BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS edgebander_rate_overridden   BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS assembly_rate_overridden     BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS delivery_rate_overridden     BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS installation_rate_overridden BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS rates_last_synced_at         TIMESTAMPTZ
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
