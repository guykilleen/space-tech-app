const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function getAll(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function getOne(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required' });
  }
  const validRoles = ['admin', 'manager', 'workshop', 'readonly'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email.toLowerCase().trim(), hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
}

async function update(req, res) {
  const { name, email, role, is_active, password } = req.body;
  try {
    // Only admins can change roles; managers can edit name/email/active
    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      query = `UPDATE users SET name=$1, email=$2, role=$3, is_active=$4, password=$5
               WHERE id=$6 RETURNING id, name, email, role, is_active`;
      params = [name, email?.toLowerCase().trim(), role, is_active, hash, req.params.id];
    } else {
      query = `UPDATE users SET name=$1, email=$2, role=$3, is_active=$4
               WHERE id=$5 RETURNING id, name, email, role, is_active`;
      params = [name, email?.toLowerCase().trim(), role, is_active, req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    res.status(500).json({ error: 'Server error' });
  }
}

async function deactivate(req, res) {
  // Soft-delete: set is_active = false
  try {
    const { rows } = await pool.query(
      'UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getAll, getOne, create, update, deactivate };
