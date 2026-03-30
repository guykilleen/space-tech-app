require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function seed() {
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash('Admin1234!', 12);
    await client.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, ['Admin User', 'admin@spacetechdesign.com.au', hash, 'admin']);
    console.log('Seed complete.');
    console.log('  Admin:   admin@spacetechdesign.com.au / Admin1234!');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
