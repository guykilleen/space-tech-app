// Runs once after all test suites.
// Truncates test data; leaves schema intact for faster re-runs.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

const { Client } = require('pg');

module.exports = async function () {
  const db = new Client({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 5432,
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'space_tech_design_test',
  });
  await db.connect();
  await db.query('TRUNCATE jobs, quotes, users RESTART IDENTITY CASCADE');
  await db.end();
};
