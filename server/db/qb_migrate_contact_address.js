const pool = require('../config/db');

async function migrate() {
  await pool.query(`
    ALTER TABLE qb_contacts
    ADD COLUMN IF NOT EXISTS address VARCHAR(200)
  `);
  console.log('qb_contacts.address column added');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
