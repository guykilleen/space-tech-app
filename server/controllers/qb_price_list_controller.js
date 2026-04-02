const pool = require('../config/db');

async function getAll(req, res) {
  const { category, active } = req.query;
  const params = [];
  let sql = `SELECT * FROM qb_price_list WHERE 1=1`;
  if (category)          { params.push(category);        sql += ` AND category = $${params.length}`; }
  if (active !== undefined) { params.push(active === 'true'); sql += ` AND active = $${params.length}`; }
  sql += ` ORDER BY category, sort_order, product`;
  try {
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getOne(req, res) {
  try {
    const { rows } = await pool.query(`SELECT * FROM qb_price_list WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const { category, product, price, unit, active, sort_order } = req.body;
  if (!product?.trim()) return res.status(400).json({ error: 'Product name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO qb_price_list (category, product, price, unit, active, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [category || 'Materials', product.trim(), price ?? 0, unit?.trim() || null, active !== false, sort_order ?? 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function update(req, res) {
  const { category, product, price, unit, active, sort_order } = req.body;
  if (!product?.trim()) return res.status(400).json({ error: 'Product name required' });
  try {
    const { rows } = await pool.query(
      `UPDATE qb_price_list SET category=$1, product=$2, price=$3, unit=$4, active=$5, sort_order=$6 WHERE id=$7 RETURNING *`,
      [category || 'Materials', product.trim(), price ?? 0, unit?.trim() || null, active !== false, sort_order ?? 0, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function toggleActive(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE qb_price_list SET active = NOT active WHERE id = $1 RETURNING *`,
      [req.params.id]
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
    const { rowCount } = await pool.query(`DELETE FROM qb_price_list WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'Item is used in quotes — deactivate instead' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getAll, getOne, create, update, toggleActive, remove };
