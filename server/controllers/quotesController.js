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
      `SELECT q.*, u.name AS created_by_name,
              c.company AS client_company
       FROM quotes q
       LEFT JOIN users u ON q.created_by = u.id
       LEFT JOIN qb_quote_headers h ON h.quote_id = q.id
       LEFT JOIN qb_contacts c ON h.client_id = c.id
       ${whereClause}
       ORDER BY q.quote_number DESC`,
      params
    );

    // Enrich each JT quote with its QB revision group
    if (rows.length) {
      const jtIds = rows.map(r => r.id);
      const { rows: revRows } = await pool.query(
        `WITH linked AS (
           SELECT h.id, COALESCE(h.parent_quote_id, h.id) AS root_id, h.quote_id
           FROM qb_quote_headers h
           WHERE h.quote_id = ANY($1::uuid[])
         )
         SELECT
           l.quote_id AS jt_id,
           m.id AS qb_id,
           m.quote_number AS qb_number,
           m.status AS qb_status,
           m.revision_sequence,
           m.revision_suffix,
           m.parent_quote_id
         FROM linked l
         JOIN qb_quote_headers m ON (m.id = l.root_id OR m.parent_quote_id = l.root_id)
         ORDER BY l.quote_id, m.revision_sequence`,
        [jtIds]
      );
      const revByJtId = {};
      for (const r of revRows) {
        if (!revByJtId[r.jt_id]) revByJtId[r.jt_id] = [];
        revByJtId[r.jt_id].push(r);
      }
      for (const q of rows) {
        q.qb_revisions = revByJtId[q.id] || [];
      }
    }

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
    value = 0, status = 'draft', accept_details, accept_date
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
  const valid = ['draft','sent','accepted'];
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
