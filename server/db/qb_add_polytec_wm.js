// One-time script: adds 'Polytec 162412 WM' to qb_price_list if not already present.
// Run: node server/db/qb_add_polytec_wm.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
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

async function run() {
  const { rows } = await pool.query(
    `SELECT id FROM qb_price_list WHERE category = 'Materials' AND product = 'Polytec 162412 WM'`
  );
  if (rows.length > 0) {
    console.log('Polytec 162412 WM already exists — skipping.');
  } else {
    await pool.query(
      `INSERT INTO qb_price_list (category, product, price, unit, sort_order)
       VALUES ('Materials', 'Polytec 162412 WM', 155, 'sheet', 50)`
    );
    console.log('Added: Polytec 162412 WM — $155/sheet');
  }
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
