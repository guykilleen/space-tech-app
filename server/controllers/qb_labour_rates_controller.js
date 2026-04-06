const pool = require('../config/db');

const VALID_TYPES = ['admin','cnc','edgebander','assembly','delivery','installation'];

// GET /api/qb/labour-rates  →  { admin: 100, cnc: 100, ... }
async function getAll(req, res) {
  try {
    const { rows } = await pool.query('SELECT type, hourly_rate FROM labour_rates ORDER BY type');
    const rates = Object.fromEntries(rows.map(r => [r.type, Number(r.hourly_rate)]));
    res.json(rates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// PATCH /api/qb/labour-rates/:type  body: { hourly_rate }
async function updateRate(req, res) {
  const { type } = req.params;
  const { hourly_rate } = req.body;

  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid labour type' });
  if (hourly_rate == null || isNaN(Number(hourly_rate)) || Number(hourly_rate) < 0) {
    return res.status(400).json({ error: 'hourly_rate must be a non-negative number' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO labour_rates (type, hourly_rate)
       VALUES ($1, $2)
       ON CONFLICT (type) DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate, updated_at = NOW()
       RETURNING type, hourly_rate`,
      [type, Number(hourly_rate)]
    );
    res.json({ type: rows[0].type, hourly_rate: Number(rows[0].hourly_rate) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getAll, updateRate };
