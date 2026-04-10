const pool = require('../config/db');

// Parse job number into {base, sub} — e.g. "48" → {48,0}, "48_1" → {48,1}
function parseJobNum(job) {
  const s = String(job || '');
  const m = s.match(/^(\d+)(?:_(\d+))?$/);
  if (m) return { base: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0 };
  const n = s.match(/(\d+)$/);
  return { base: n ? parseInt(n[1], 10) : 0, sub: 0 };
}

async function nextJobNumber(client) {
  const { rows } = await client.query(
    `SELECT job_number FROM jobs WHERE job_number ~ '^\\d+$' ORDER BY job_number::int DESC LIMIT 1`
  );
  const last = rows[0]?.job_number;
  return last ? String(parseInt(last, 10) + 1) : '1';
}

async function nextSubJobNumber(client, parentJobStr) {
  const base = parseInt(String(parentJobStr).match(/^(\d+)/)?.[1] || '0', 10);
  const { rows } = await client.query(
    `SELECT job_number FROM jobs WHERE job_number ~ $1`,
    [`^${base}_\\d+$`]
  );
  const maxSub = rows.reduce((m, r) => {
    const sub = parseInt(r.job_number.split('_')[1] || '0', 10);
    return Math.max(m, sub);
  }, 0);
  return `${base}_${maxSub + 1}`;
}

async function getAll(req, res) {
  const { wip_completed, search } = req.query;
  let where = [], params = [];

  if (wip_completed !== undefined) {
    params.push(wip_completed === 'true');
    where.push(`j.wip_completed = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(j.job_number ILIKE $${params.length} OR j.client_name ILIKE $${params.length} OR j.project ILIKE $${params.length})`);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT j.*,
              q.quote_number AS linked_quote_number,
              q.value        AS quote_value,
              q.accept_date  AS quote_accept_date,
              q.initials     AS quote_initials,
              pj.job_number  AS parent_job_number,
              u.name         AS created_by_name
       FROM jobs j
       LEFT JOIN quotes q  ON j.quote_id = q.id
       LEFT JOIN jobs pj   ON j.parent_job_id = pj.id
       LEFT JOIN users u   ON j.created_by = u.id
       ${whereClause}
       ORDER BY j.job_number`,
      params
    );
    // Sort: highest base first, sub-jobs ascending under parent
    rows.sort((a, b) => {
      const na = parseJobNum(a.job_number), nb = parseJobNum(b.job_number);
      if (nb.base !== na.base) return nb.base - na.base;
      return na.sub - nb.sub;
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getOne(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT j.*,
              q.quote_number AS linked_quote_number,
              q.value        AS quote_value,
              q.accept_date  AS quote_accept_date,
              q.initials     AS quote_initials,
              pj.job_number  AS parent_job_number
       FROM jobs j
       LEFT JOIN quotes q  ON j.quote_id = q.id
       LEFT JOIN jobs pj   ON j.parent_job_id = pj.id
       WHERE j.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('getOne error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const {
    job_number, quote_id, quote_number, parent_job_id,
    client_name, project,
    hours_admin = 0, hours_machining = 0, hours_assembly = 0,
    hours_delivery = 0, hours_install = 0,
    wip_start, wip_due
  } = req.body;

  if (!client_name) return res.status(400).json({ error: 'client_name is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobNum = job_number?.trim() || await nextJobNumber(client);
    const { rows } = await client.query(
      `INSERT INTO jobs
         (job_number, quote_id, quote_number, parent_job_id, client_name, project,
          hours_admin, hours_machining, hours_assembly, hours_delivery, hours_install,
          wip_start, wip_due, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [jobNum, quote_id || null, quote_number || null, parent_job_id || null,
       client_name, project || null,
       hours_admin, hours_machining, hours_assembly, hours_delivery, hours_install,
       wip_start || null, wip_due || null, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Job number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const {
    job_number, quote_number, client_name, project,
    hours_admin, hours_machining, hours_assembly, hours_delivery, hours_install,
    wip_start, wip_due, wip_complete, wip_completed, notes
  } = req.body;

  try {
    const { rows: ex } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!ex[0]) return res.status(404).json({ error: 'Job not found' });
    const e = ex[0];

    const { rows } = await pool.query(
      `UPDATE jobs SET
         job_number=$1, quote_number=$2, client_name=$3, project=$4,
         hours_admin=$5, hours_machining=$6, hours_assembly=$7,
         hours_delivery=$8, hours_install=$9,
         wip_start=$10, wip_due=$11, wip_complete=$12, wip_completed=$13,
         notes=$14
       WHERE id=$15 RETURNING *`,
      [job_number ?? e.job_number, quote_number ?? e.quote_number,
       client_name ?? e.client_name, project ?? e.project,
       hours_admin ?? e.hours_admin, hours_machining ?? e.hours_machining,
       hours_assembly ?? e.hours_assembly, hours_delivery ?? e.hours_delivery,
       hours_install ?? e.hours_install,
       wip_start !== undefined ? wip_start || null : e.wip_start,
       wip_due   !== undefined ? wip_due   || null : e.wip_due,
       wip_complete  ?? e.wip_complete,
       wip_completed ?? e.wip_completed,
       notes !== undefined ? notes || null : e.notes,
       req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Job number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateWip(req, res) {
  const {
    wip_due, wip_completed,
    wip_hours_admin, wip_hours_machining, wip_hours_assembly,
    wip_hours_delivery, wip_hours_install
  } = req.body;
  try {
    const { rows: cur } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ error: 'Job not found' });
    const job = cur[0];

    const updates = [];
    const params  = [];

    if (wip_due       !== undefined) { params.push(wip_due || null); updates.push(`wip_due=$${params.length}`); }
    if (wip_completed !== undefined) { params.push(wip_completed);   updates.push(`wip_completed=$${params.length}`); }

    const hoursFields = { wip_hours_admin, wip_hours_machining, wip_hours_assembly, wip_hours_delivery, wip_hours_install };
    let anyHours = false;
    for (const [col, val] of Object.entries(hoursFields)) {
      if (val !== undefined) {
        params.push(parseFloat(val) || 0);
        updates.push(`${col}=$${params.length}`);
        anyHours = true;
      }
    }

    // Auto-calculate wip_complete from actual vs planned hours
    if (anyHours) {
      const actual = (wip_hours_admin    !== undefined ? parseFloat(wip_hours_admin)    : parseFloat(job.wip_hours_admin    || 0))
                   + (wip_hours_machining !== undefined ? parseFloat(wip_hours_machining) : parseFloat(job.wip_hours_machining || 0))
                   + (wip_hours_assembly  !== undefined ? parseFloat(wip_hours_assembly)  : parseFloat(job.wip_hours_assembly  || 0))
                   + (wip_hours_delivery  !== undefined ? parseFloat(wip_hours_delivery)  : parseFloat(job.wip_hours_delivery  || 0))
                   + (wip_hours_install   !== undefined ? parseFloat(wip_hours_install)   : parseFloat(job.wip_hours_install   || 0));
      const planned = parseFloat(job.total_hours || 0);
      const pct = planned > 0 ? Math.min(100, Math.round(actual / planned * 100)) : 0;
      params.push(pct);
      updates.push(`wip_complete=$${params.length}`);
    }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE jobs SET ${updates.join(', ')} WHERE id=$${params.length} RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    const { rowCount } = await pool.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Job not found' });
    res.json({ message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

// Convert accepted quote → new job (with optional sub-job support)
async function convertFromQuote(req, res) {
  const { parent_job_id, wip_due,
          hours_admin = 0, hours_machining = 0, hours_assembly = 0,
          hours_delivery = 0, hours_install = 0 } = req.body;
  try {
    const { rows: qRows } = await pool.query('SELECT * FROM quotes WHERE id = $1', [req.params.id]);
    const quote = qRows[0];
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.status !== 'accepted') {
      return res.status(400).json({ error: 'Quote must be accepted first' });
    }
    // Check not already converted
    const { rows: existing } = await pool.query(
      'SELECT id FROM jobs WHERE quote_id = $1 LIMIT 1', [quote.id]
    );
    if (existing[0]) return res.status(409).json({ error: 'Job already exists for this quote' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let jobNum;
      if (parent_job_id) {
        const { rows: pj } = await client.query('SELECT job_number FROM jobs WHERE id = $1', [parent_job_id]);
        if (!pj[0]) throw new Error('Parent job not found');
        jobNum = await nextSubJobNumber(client, pj[0].job_number);
      } else {
        jobNum = await nextJobNumber(client);
      }

      const { rows } = await client.query(
        `INSERT INTO jobs
           (job_number, quote_id, quote_number, parent_job_id, client_name, project,
            hours_admin, hours_machining, hours_assembly, hours_delivery, hours_install,
            wip_start, wip_due, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [jobNum, quote.id, quote.quote_number, parent_job_id || null,
         quote.client_name, quote.project,
         hours_admin, hours_machining, hours_assembly, hours_delivery, hours_install,
         quote.accept_date || null, wip_due || null, req.user.id]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}

async function markAllComplete(req, res) {
  try {
    const { rowCount } = await pool.query(
      `UPDATE jobs SET wip_completed = true, wip_complete = 100 WHERE wip_completed = false`
    );
    res.json({ updated: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getAll, getOne, create, update, updateWip, remove, convertFromQuote, markAllComplete };
