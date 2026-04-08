const pool = require('../config/db');

async function getAll(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM qb_contacts ORDER BY company NULLS LAST, name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getOne(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM qb_contacts WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const { name, email, company, phone, address } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO qb_contacts (name, email, company, phone, address) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), email?.trim() || null, company?.trim() || null, phone?.trim() || null, address?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function update(req, res) {
  const { name, email, company, phone, address } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE qb_contacts SET name=$1, email=$2, company=$3, phone=$4, address=$5 WHERE id=$6 RETURNING *`,
      [name.trim(), email?.trim() || null, company?.trim() || null, phone?.trim() || null, address?.trim() || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM qb_contacts WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Contact is referenced by quotes — cannot delete' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getAll, getOne, create, update, remove };
