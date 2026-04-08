const pool = require('../config/db');

// Generate next quote number across all formats (Q-XXX, V-NNNN, VQ-NNNN)
async function nextQuoteNumber(client, prefix = 'Q-') {
  // Filter to strict Q-XXXX format only (excludes VQ-, Q-405.1 style entries, etc.)
  const { rows: [r] } = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(quote_number FROM 3) AS INTEGER)), 0) AS max
     FROM quotes
     WHERE quote_number ~ '^Q-[0-9]+$'`
  );
  const next = Number(r.max) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function getNextNumber(req, res) {
  const client = await pool.connect();
  try {
    const next = await nextQuoteNumber(client);
    res.json({ next_number: next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function getAll(req, res) {
  const { status, search } = req.query;
  let where = [], params = [];
  if (status) { params.push(status); where.push(`q.status = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(q.quote_number ILIKE $${params.length} OR q.client_name ILIKE $${params.length} OR q.project ILIKE $${params.length})`);
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT q.*, u.name AS created_by_name
       FROM quotes q LEFT JOIN users u ON q.created_by = u.id
       ${whereClause}
       ORDER BY q.quote_number DESC`,
      params
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
      `SELECT q.*, u.name AS created_by_name
       FROM quotes q LEFT JOIN users u ON q.created_by = u.id
       WHERE q.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quote not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const {
    quote_number, initials, date, client_name, project,
    value = 0, status = 'pending', accept_details, accept_date
  } = req.body;

  if (!client_name) return res.status(400).json({ error: 'client_name is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const qNum = quote_number?.trim() || await nextQuoteNumber(client);
    const { rows } = await client.query(
      `INSERT INTO quotes
         (quote_number, initials, date, client_name, project, value, status, accept_details, accept_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [qNum, initials || null, date || null, client_name, project || null,
       value === '' ? 0 : value, status, accept_details || null, accept_date || null, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Quote number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const {
    quote_number, initials, date, client_name, project,
    value, status, accept_details, accept_date
  } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT * FROM quotes WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Quote not found' });
    const e = existing[0];
    const prevStatus = e.status;

    const { rows } = await pool.query(
      `UPDATE quotes SET
         quote_number=$1, initials=$2, date=$3, client_name=$4, project=$5,
         value=$6, status=$7, accept_details=$8, accept_date=$9
       WHERE id=$10 RETURNING *`,
      [quote_number || e.quote_number, initials || e.initials,
       date || e.date, client_name || e.client_name, project || e.project,
       (value === '' ? 0 : value) ?? e.value, status || e.status,
       accept_details || e.accept_details, accept_date || null,
       req.params.id]
    );

    // If status just changed to accepted, signal front-end to offer job creation
    res.json({ ...rows[0], _statusChanged: prevStatus !== 'accepted' && rows[0].status === 'accepted' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Quote number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateStatus(req, res) {
  const { status } = req.body;
  const valid = ['pending','review','accepted','declined'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query(
      'UPDATE quotes SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quote not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    const { rowCount } = await pool.query('DELETE FROM quotes WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Quote not found' });
    res.json({ message: 'Quote deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getAll, getOne, getNextNumber, create, update, updateStatus, remove };
