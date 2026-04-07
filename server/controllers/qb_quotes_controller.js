const pool = require('../config/db');
const fs   = require('fs');
const path = require('path');

// ── Helpers ───────────────────────────────────────────────────────────────

async function fetchFull(id) {
  const { rows: [header] } = await pool.query(
    `SELECT h.*,
            c.name    AS contact_name,
            c.email   AS contact_email,
            c.company AS contact_company,
            q.client_name AS jt_client_name
     FROM qb_quote_headers h
     LEFT JOIN qb_contacts c ON h.client_id = c.id
     LEFT JOIN quotes q ON h.quote_id = q.id
     WHERE h.id = $1`,
    [id]
  );
  if (!header) return null;

  const { rows: units } = await pool.query(
    `SELECT * FROM qb_quote_units WHERE quote_id = $1 ORDER BY sort_order, unit_number`,
    [id]
  );

  if (units.length) {
    const { rows: lines } = await pool.query(
      `SELECT * FROM qb_quote_unit_lines
       WHERE unit_id = ANY($1::uuid[])
       ORDER BY unit_id, sort_order, created_at`,
      [units.map(u => u.id)]
    );
    for (const u of units) u.lines = lines.filter(l => l.unit_id === u.id);
  } else {
    for (const u of units) u.lines = [];
  }

  header.units = units;
  return header;
}

// ── Quote CRUD ────────────────────────────────────────────────────────────

async function getNextNumber(req, res) {
  try {
    const { rows: [r1] } = await pool.query(
      `SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(quote_number, '[^0-9]', '', 'g') AS INTEGER)), 0) AS max FROM quotes`
    );
    const { rows: [r2] } = await pool.query(
      `SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(quote_number, '[^0-9]', '', 'g') AS INTEGER)), 0) AS max FROM qb_quote_headers`
    );
    const next = Math.max(Number(r1.max), Number(r2.max)) + 1;
    res.json({ next_number: `V-${String(next).padStart(4, '0')}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getAll(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        h.id, h.quote_number, h.date, h.project, h.prepared_by, h.status, h.margin,
        h.created_at,
        c.name    AS client_name,
        c.company AS client_company,
        (
          SELECT COALESCE(SUM(
            (COALESCE(m.s, 0) * (1 + h.waste_pct) + COALESCE(w.s, 0) +
             (u.admin_hours * u.admin_rate + u.cnc_hours * u.cnc_rate +
              u.edgebander_hours * u.edgebander_rate + u.assembly_hours * u.assembly_rate +
              u.delivery_hours * u.delivery_rate + u.installation_hours * u.installation_rate)
            ) * (1 + h.margin) * u.quantity
          ), 0)
          FROM qb_quote_units u
          LEFT JOIN (
            SELECT unit_id, SUM(total) AS s
            FROM qb_quote_unit_lines WHERE category = 'Materials' GROUP BY unit_id
          ) m ON m.unit_id = u.id
          LEFT JOIN (
            SELECT unit_id, SUM(total) AS s
            FROM qb_quote_unit_lines WHERE category = 'Hardware' GROUP BY unit_id
          ) w ON w.unit_id = u.id
          WHERE u.quote_id = h.id
        ) AS subtotal_ex_gst
      FROM qb_quote_headers h
      LEFT JOIN qb_contacts c ON h.client_id = c.id
      ORDER BY h.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getOne(req, res) {
  try {
    const quote = await fetchFull(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Not found' });
    res.json(quote);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// Creates or fully updates a quote (header + all units + lines) in one transaction.
// Body:
//   { quote_number, date, client_id, project, prepared_by, margin, status, notes,
//     units: [ { id?, unit_number, drawing_number, room_number, level, description, quantity, sort_order,
//                lines: [ { id?, price_list_id?, category, product, price, unit_of_measure, quantity, sort_order } ] } ],
//     deleted_unit_ids: [],
//     deleted_line_ids: [] }
async function _upsertFull(quoteId, body, client) {
  const {
    quote_number, date, project, prepared_by, margin, waste_pct, status, notes,
    client_id,
    quote_id = null,        // FK → quotes.id (Job Tracker)
    units = [],
    deleted_unit_ids = [],
    deleted_line_ids = [],
  } = body;

  if (quoteId) {
    // UPDATE header (never overwrite quote_id once set)
    await client.query(
      `UPDATE qb_quote_headers
       SET quote_number=$1, date=$2, client_id=$3, project=$4, prepared_by=$5,
           margin=$6, status=$7, notes=$8, waste_pct=$9
       WHERE id=$10`,
      [quote_number, date || new Date(), client_id || null, project || null,
       prepared_by || null, margin ?? 0.15, status || 'draft', notes || null,
       waste_pct ?? 0.10, quoteId]
    );
  } else {
    // INSERT header
    const { rows: [h] } = await client.query(
      `INSERT INTO qb_quote_headers
         (quote_number, date, client_id, project, prepared_by, margin, waste_pct, status, notes, quote_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [quote_number, date || new Date(), client_id || null, project || null,
       prepared_by || null, margin ?? 0.15, waste_pct ?? 0.10, status || 'draft', notes || null,
       quote_id || null]
    );
    quoteId = h.id;
  }

  // Delete removed units (lines cascade)
  if (deleted_unit_ids.length) {
    await client.query(
      `DELETE FROM qb_quote_units WHERE id = ANY($1::uuid[]) AND quote_id = $2`,
      [deleted_unit_ids, quoteId]
    );
  }

  // Delete removed lines (within units that still exist)
  if (deleted_line_ids.length) {
    await client.query(
      `DELETE FROM qb_quote_unit_lines
       WHERE id = ANY($1::uuid[])
         AND unit_id IN (SELECT id FROM qb_quote_units WHERE quote_id = $2)`,
      [deleted_line_ids, quoteId]
    );
  }

  // Fetch current labour rates once — snapshotted onto newly inserted units only
  const { rows: rateRows } = await client.query('SELECT type, hourly_rate FROM labour_rates');
  const rates = Object.fromEntries(rateRows.map(r => [r.type, Number(r.hourly_rate)]));
  const R = (t) => rates[t] ?? 100;

  // Upsert units and their lines
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    let unitId = u.id || null;

    const adminH    = u.admin_hours        ?? 0;
    const cncH      = u.cnc_hours          ?? 0;
    const edgeH     = u.edgebander_hours   ?? 0;
    const assemblyH = u.assembly_hours     ?? 0;
    const deliveryH = u.delivery_hours     ?? 0;
    const installH  = u.installation_hours ?? 0;

    if (unitId) {
      // UPDATE — update hours; also accept manually overridden rates and override flags.
      // COALESCE preserves existing DB value when the field is omitted (null) from body.
      await client.query(
        `UPDATE qb_quote_units
         SET unit_number=$1, drawing_number=$2, room_number=$3, level=$4,
             description=$5, quantity=$6, sort_order=$7,
             admin_hours=$8, cnc_hours=$9, edgebander_hours=$10, assembly_hours=$11,
             delivery_hours=$12, installation_hours=$13,
             admin_rate        = COALESCE($14, admin_rate),
             cnc_rate          = COALESCE($15, cnc_rate),
             edgebander_rate   = COALESCE($16, edgebander_rate),
             assembly_rate     = COALESCE($17, assembly_rate),
             delivery_rate     = COALESCE($18, delivery_rate),
             installation_rate = COALESCE($19, installation_rate),
             admin_rate_overridden        = COALESCE($20, admin_rate_overridden),
             cnc_rate_overridden          = COALESCE($21, cnc_rate_overridden),
             edgebander_rate_overridden   = COALESCE($22, edgebander_rate_overridden),
             assembly_rate_overridden     = COALESCE($23, assembly_rate_overridden),
             delivery_rate_overridden     = COALESCE($24, delivery_rate_overridden),
             installation_rate_overridden = COALESCE($25, installation_rate_overridden)
         WHERE id=$26 AND quote_id=$27`,
        [u.unit_number ?? i + 1, u.drawing_number || null, u.room_number || null,
         u.level || null, u.description || null, u.quantity ?? 1, u.sort_order ?? i,
         adminH, cncH, edgeH, assemblyH, deliveryH, installH,
         u.admin_rate        ?? null, u.cnc_rate          ?? null,
         u.edgebander_rate   ?? null, u.assembly_rate     ?? null,
         u.delivery_rate     ?? null, u.installation_rate ?? null,
         u.admin_rate_overridden        ?? null, u.cnc_rate_overridden          ?? null,
         u.edgebander_rate_overridden   ?? null, u.assembly_rate_overridden     ?? null,
         u.delivery_rate_overridden     ?? null, u.installation_rate_overridden ?? null,
         unitId, quoteId]
      );
    } else {
      // INSERT — snapshot current rates so this unit's labour cost is frozen at today's rates
      const { rows: [row] } = await client.query(
        `INSERT INTO qb_quote_units
           (quote_id, unit_number, drawing_number, room_number, level, description, quantity, sort_order,
            admin_hours, cnc_hours, edgebander_hours, assembly_hours, delivery_hours, installation_hours,
            admin_rate, cnc_rate, edgebander_rate, assembly_rate, delivery_rate, installation_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
        [quoteId, u.unit_number ?? i + 1, u.drawing_number || null, u.room_number || null,
         u.level || null, u.description || null, u.quantity ?? 1, u.sort_order ?? i,
         adminH, cncH, edgeH, assemblyH, deliveryH, installH,
         R('admin'), R('cnc'), R('edgebander'), R('assembly'), R('delivery'), R('installation')]
      );
      unitId = row.id;
    }

    for (let j = 0; j < (u.lines || []).length; j++) {
      const l = u.lines[j];
      if (l.id) {
        await client.query(
          `UPDATE qb_quote_unit_lines
           SET price_list_id=$1, category=$2, product=$3, price=$4,
               unit_of_measure=$5, quantity=$6, sort_order=$7,
               price_overridden = COALESCE($8, price_overridden)
           WHERE id=$9 AND unit_id=$10`,
          [l.price_list_id || null, l.category || 'Materials', l.product,
           l.price ?? 0, l.unit_of_measure || null, l.quantity ?? 0, l.sort_order ?? j,
           l.price_overridden ?? null, l.id, unitId]
        );
      } else {
        await client.query(
          `INSERT INTO qb_quote_unit_lines (unit_id, price_list_id, category, product, price, unit_of_measure, quantity, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [unitId, l.price_list_id || null, l.category || 'Materials', l.product,
           l.price ?? 0, l.unit_of_measure || null, l.quantity ?? 0, l.sort_order ?? j]
        );
      }
    }
  }

  // Write calculated subtotal (ex-GST) back to quotes.value when linked
  const { rows: [hdr] } = await client.query(
    'SELECT quote_id, margin, waste_pct FROM qb_quote_headers WHERE id = $1', [quoteId]
  );
  if (hdr?.quote_id) {
    const { rows: [tot] } = await client.query(`
      SELECT COALESCE(SUM(
        (COALESCE(m.s, 0) * (1 + $2::numeric) + COALESCE(w.s, 0) +
         (u.admin_hours * u.admin_rate + u.cnc_hours * u.cnc_rate +
          u.edgebander_hours * u.edgebander_rate + u.assembly_hours * u.assembly_rate +
          u.delivery_hours * u.delivery_rate + u.installation_hours * u.installation_rate)
        ) * (1 + $3::numeric) * u.quantity
      ), 0) AS subtotal
      FROM qb_quote_units u
      LEFT JOIN (
        SELECT unit_id, SUM(total) AS s FROM qb_quote_unit_lines WHERE category = 'Materials' GROUP BY unit_id
      ) m ON m.unit_id = u.id
      LEFT JOIN (
        SELECT unit_id, SUM(total) AS s FROM qb_quote_unit_lines WHERE category = 'Hardware' GROUP BY unit_id
      ) w ON w.unit_id = u.id
      WHERE u.quote_id = $1
    `, [quoteId, hdr.waste_pct, hdr.margin]);
    await client.query('UPDATE quotes SET value = $1 WHERE id = $2', [Number(tot.subtotal), hdr.quote_id]);
  }

  return quoteId;
}

async function create(req, res) {
  if (!req.body.quote_number?.trim()) return res.status(400).json({ error: 'Quote number required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const quoteId = await _upsertFull(null, req.body, client);
    await client.query('COMMIT');
    const quote = await fetchFull(quoteId);
    res.status(201).json(quote);
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await _upsertFull(req.params.id, req.body, client);
    await client.query('COMMIT');
    const quote = await fetchFull(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Not found' });
    res.json(quote);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Quote number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function updateStatus(req, res) {
  const { status } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE qb_quote_headers SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
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
      `DELETE FROM qb_quote_headers WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Computed views ────────────────────────────────────────────────────────

async function getSummary(req, res) {
  try {
    const { rows: [header] } = await pool.query(
      `SELECT h.margin, h.waste_pct, c.name AS client_name, c.company AS contact_company, h.quote_number, h.date, h.project, h.prepared_by
       FROM qb_quote_headers h LEFT JOIN qb_contacts c ON h.client_id = c.id
       WHERE h.id = $1`,
      [req.params.id]
    );
    if (!header) return res.status(404).json({ error: 'Not found' });

    const { rows: units } = await pool.query(
      `SELECT u.id, u.unit_number, u.drawing_number, u.room_number, u.level, u.description, u.quantity,
              u.admin_hours, u.cnc_hours, u.edgebander_hours, u.assembly_hours,
              u.delivery_hours, u.installation_hours,
              u.admin_rate, u.cnc_rate, u.edgebander_rate, u.assembly_rate,
              u.delivery_rate, u.installation_rate,
              COALESCE(m.s, 0) AS mat_sub,
              COALESCE(w.s, 0) AS hw_sub
       FROM qb_quote_units u
       LEFT JOIN (
         SELECT unit_id, SUM(total) AS s FROM qb_quote_unit_lines
         WHERE category = 'Materials' GROUP BY unit_id
       ) m ON m.unit_id = u.id
       LEFT JOIN (
         SELECT unit_id, SUM(total) AS s FROM qb_quote_unit_lines
         WHERE category = 'Hardware' GROUP BY unit_id
       ) w ON w.unit_id = u.id
       WHERE u.quote_id = $1
       ORDER BY u.sort_order, u.unit_number`,
      [req.params.id]
    );

    const margin   = Number(header.margin);
    const wastePct = Number(header.waste_pct);
    let subtotal = 0;
    const rows = units.map(u => {
      const matSub    = Number(u.mat_sub);
      const hwSub     = Number(u.hw_sub);
      const labourSub = Number(u.admin_hours)        * Number(u.admin_rate) +
                        Number(u.cnc_hours)           * Number(u.cnc_rate) +
                        Number(u.edgebander_hours)    * Number(u.edgebander_rate) +
                        Number(u.assembly_hours)      * Number(u.assembly_rate) +
                        Number(u.delivery_hours)      * Number(u.delivery_rate) +
                        Number(u.installation_hours)  * Number(u.installation_rate);
      const unitCost  = (matSub * (1 + wastePct) + hwSub + labourSub) * (1 + margin);
      const total     = unitCost * Number(u.quantity);
      subtotal += total;
      return { ...u, labour_sub: labourSub, unit_cost: unitCost, total };
    });

    const gst            = subtotal * 0.10;
    const total_incl_gst = subtotal + gst;

    res.json({ ...header, units: rows, subtotal, gst, total_incl_gst });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getBudgetQty(req, res) {
  try {
    const { rows: [header] } = await pool.query(
      `SELECT margin, waste_pct FROM qb_quote_headers WHERE id = $1`,
      [req.params.id]
    );
    if (!header) return res.status(404).json({ error: 'Not found' });

    // Aggregated line items (Materials & Hardware)
    const { rows: lines } = await pool.query(`
      SELECT
        l.product,
        l.category,
        l.unit_of_measure,
        l.price,
        SUM(l.quantity * u.quantity)           AS total_qty,
        l.price * SUM(l.quantity * u.quantity) AS total_cost_allowed
      FROM qb_quote_unit_lines l
      JOIN qb_quote_units u ON l.unit_id = u.id
      WHERE u.quote_id = $1
      GROUP BY l.product, l.category, l.unit_of_measure, l.price
      ORDER BY l.category, l.product
    `, [req.params.id]);

    // Labour hours and costs totalled across all units (hours × rate × unit qty)
    const { rows: [labour] } = await pool.query(`
      SELECT
        COALESCE(SUM(admin_hours        * quantity), 0) AS admin_hours,
        COALESCE(SUM(cnc_hours          * quantity), 0) AS cnc_hours,
        COALESCE(SUM(edgebander_hours   * quantity), 0) AS edgebander_hours,
        COALESCE(SUM(assembly_hours     * quantity), 0) AS assembly_hours,
        COALESCE(SUM(delivery_hours     * quantity), 0) AS delivery_hours,
        COALESCE(SUM(installation_hours * quantity), 0) AS installation_hours,
        COALESCE(SUM(admin_hours        * quantity * admin_rate),        0) AS admin_cost,
        COALESCE(SUM(cnc_hours          * quantity * cnc_rate),          0) AS cnc_cost,
        COALESCE(SUM(edgebander_hours   * quantity * edgebander_rate),   0) AS edgebander_cost,
        COALESCE(SUM(assembly_hours     * quantity * assembly_rate),     0) AS assembly_cost,
        COALESCE(SUM(delivery_hours     * quantity * delivery_rate),     0) AS delivery_cost,
        COALESCE(SUM(installation_hours * quantity * installation_rate), 0) AS installation_cost
      FROM qb_quote_units
      WHERE quote_id = $1
    `, [req.params.id]);

    const margin      = Number(header.margin);
    const wastePct    = Number(header.waste_pct);
    const matRaw      = lines.filter(l => l.category === 'Materials')
                             .reduce((s, l) => s + Number(l.total_cost_allowed), 0);
    const hwTotal     = lines.filter(l => l.category === 'Hardware')
                             .reduce((s, l) => s + Number(l.total_cost_allowed), 0);
    const labourHrs   = {
      admin_hours:        Number(labour.admin_hours),
      cnc_hours:          Number(labour.cnc_hours),
      edgebander_hours:   Number(labour.edgebander_hours),
      assembly_hours:     Number(labour.assembly_hours),
      delivery_hours:     Number(labour.delivery_hours),
      installation_hours: Number(labour.installation_hours),
      admin_cost:         Number(labour.admin_cost),
      cnc_cost:           Number(labour.cnc_cost),
      edgebander_cost:    Number(labour.edgebander_cost),
      assembly_cost:      Number(labour.assembly_cost),
      delivery_cost:      Number(labour.delivery_cost),
      installation_cost:  Number(labour.installation_cost),
    };
    const labourTotal = labourHrs.admin_cost + labourHrs.cnc_cost + labourHrs.edgebander_cost +
                        labourHrs.assembly_cost + labourHrs.delivery_cost + labourHrs.installation_cost;
    const wasteAmount    = matRaw * wastePct;
    const matWithWaste   = matRaw + wasteAmount;
    const costsTotal     = matWithWaste + hwTotal + labourTotal;
    const marginAmount   = costsTotal * margin;
    const subtotal       = costsTotal + marginAmount;
    const gst            = subtotal * 0.10;
    const total          = subtotal + gst;

    res.json({
      margin,
      waste_pct: wastePct,
      lines,
      labour: labourHrs,
      totals: {
        materials_raw:   matRaw,
        waste_amount:    wasteAmount,
        materials:       matWithWaste,
        hardware:        hwTotal,
        labour:          labourTotal,
        costs_total:     costsTotal,
        margin_amount:   marginAmount,
        subtotal,
        gst,
        total,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getPdf(req, res) {

  try {
    const quote = await fetchFull(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Not found' });

    // ── Calculations ──────────────────────────────────────────────────────
    const margin   = Number(quote.margin);
    const wastePct = Number(quote.waste_pct);
    let subtotal   = 0;

    const unitRows = quote.units.map(u => {
      const matSub    = u.lines.filter(l => l.category === 'Materials').reduce((s, l) => s + Number(l.total), 0);
      const hwSub     = u.lines.filter(l => l.category === 'Hardware').reduce((s, l)  => s + Number(l.total), 0);
      const labourSub = Number(u.admin_hours)       * Number(u.admin_rate) +
                        Number(u.cnc_hours)          * Number(u.cnc_rate) +
                        Number(u.edgebander_hours)   * Number(u.edgebander_rate) +
                        Number(u.assembly_hours)     * Number(u.assembly_rate) +
                        Number(u.delivery_hours)     * Number(u.delivery_rate) +
                        Number(u.installation_hours) * Number(u.installation_rate);
      const unitCost  = (matSub * (1 + wastePct) + hwSub + labourSub) * (1 + margin);
      const total     = unitCost * Number(u.quantity);
      subtotal += total;
      return { ...u, unit_cost: unitCost, total };
    });

    const gst            = subtotal * 0.10;
    const total_incl_gst = subtotal + gst;

    // ── Formatters ────────────────────────────────────────────────────────
    const fmt  = v => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
    const fmtD = v => v ? new Date(v).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const esc  = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // ── Build unit rows HTML ──────────────────────────────────────────────
    const unitRowsHtml = unitRows.map(u => {
      const roomLevel = [u.room_number, u.level].filter(Boolean).join(' / ');
      return `
      <tr>
        <td class="muted">${esc(u.unit_number)}</td>
        <td class="muted">${esc(roomLevel)}</td>
        <td>
          ${u.description ? `<div class="item-desc">${esc(u.description)}</div>` : ''}
          ${u.drawing_number ? `<div class="item-sub">Dwg: ${esc(u.drawing_number)}</div>` : ''}
        </td>
        <td class="muted">&nbsp;</td>
        <td class="right">${Number(u.quantity) % 1 === 0 ? Number(u.quantity) : Number(u.quantity).toFixed(2)}</td>
        <td class="right">${fmt(u.unit_cost)}</td>
        <td class="right"><strong>${fmt(u.total)}</strong></td>
      </tr>`;
    }).join('');

    // ── Build client block ────────────────────────────────────────────────
    const clientLines = [
      quote.contact_name    ? `<strong>${esc(quote.contact_name)}</strong>` : null,
      quote.contact_company ? esc(quote.contact_company)                    : null,
      quote.contact_email   ? esc(quote.contact_email)                      : null,
      quote.contact_phone   ? esc(quote.contact_phone)                      : null,
    ].filter(Boolean);
    const clientBlock = clientLines.length
      ? clientLines.join('<br>')
      : '<em style="color:#aaa">No client details</em>';

    // ── Optional template rows ────────────────────────────────────────────
    const preparedByRow = quote.prepared_by
      ? `<tr><td>Prepared by</td><td>${esc(quote.prepared_by)}</td></tr>`
      : '';
    const projectRow = quote.project
      ? `<tr><td>Project</td><td>${esc(quote.project)}</td></tr>`
      : '';

    const statusLabels = { draft: 'Draft', pending: 'Pending', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' };
    const statusBadge = statusLabels[quote.status] || esc(quote.status);

    const notesBlock = quote.notes
      ? `<div class="notes-section"><strong>Notes</strong>${esc(quote.notes)}</div>`
      : '';

    // ── Filename ─────────────────────────────────────────────────────────
    const clientSlug = (quote.contact_company || quote.contact_name || 'Client')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    const filename = `Quote-${quote.quote_number}-${clientSlug}.pdf`;

    // ── Load template and inject ──────────────────────────────────────────
    const templatePath = path.join(__dirname, '../templates/quote-pdf.html');
    let html = fs.readFileSync(templatePath, 'utf8');

    html = html
      .replace(/\{\{QUOTE_NUMBER\}\}/g,  esc(quote.quote_number))
      .replace(/\{\{DATE\}\}/g,           fmtD(quote.date))
      .replace(/\{\{CLIENT_BLOCK\}\}/g,   clientBlock)
      .replace(/\{\{PREPARED_BY_ROW\}\}/g, preparedByRow)
      .replace(/\{\{PROJECT_ROW\}\}/g,    projectRow)
      .replace(/\{\{STATUS_BADGE\}\}/g,   statusBadge)
      .replace(/\{\{UNIT_ROWS\}\}/g,      unitRowsHtml)
      .replace(/\{\{SUBTOTAL\}\}/g,       fmt(subtotal))
      .replace(/\{\{GST\}\}/g,            fmt(gst))
      .replace(/\{\{TOTAL_INCL_GST\}\}/g, fmt(total_incl_gst))
      .replace(/\{\{NOTES_BLOCK\}\}/g,    notesBlock);

    // ── Render PDF ────────────────────────────────────────────────────────
    // Launch priority:
    //   1. PUPPETEER_EXECUTABLE_PATH set (Dockerfile — system Chromium via apt)
    //   2. NODE_ENV=production without exec path (@sparticuz/chromium fallback)
    //   3. Local dev — full puppeteer with its bundled Chrome
    const CHROMIUM_ARGS = [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote',
    ];
    let browser;
    const sysExecPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (sysExecPath) {
      console.log('[PDF] using system Chromium:', sysExecPath);
      const puppeteerCore = require('puppeteer-core');
      browser = await puppeteerCore.launch({
        headless: true, executablePath: sysExecPath, args: CHROMIUM_ARGS,
      });
    } else if (process.env.NODE_ENV === 'production') {
      console.log('[PDF] using @sparticuz/chromium');
      const chromium = require('@sparticuz/chromium');
      const puppeteerCore = require('puppeteer-core');
      browser = await puppeteerCore.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    } else {
      console.log('[PDF] using local puppeteer (dev)');
      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch({ headless: true, args: CHROMIUM_ARGS });
    }
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '0mm', right: '0mm' },
    });
    await browser.close();

    // puppeteer v21+ returns Uint8Array — convert to Buffer for Express
    const pdf = Buffer.from(pdfBytes);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    res.send(pdf);
  } catch (err) {
    console.error('[PDF] generation error:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: 'PDF generation failed', detail: err.message });
  }
}

// ── Rate override helpers ─────────────────────────────────────────────────

const EDITABLE_STATUSES = ['draft', 'pending'];

// Returns a preview of what would change if rates were synced for a given unit.
// No writes — purely informational.
async function getRateDiff(req, res) {
  const { id, unitId } = req.params;
  try {
    const { rows: [header] } = await pool.query(
      'SELECT status FROM qb_quote_headers WHERE id = $1', [id]
    );
    if (!header) return res.status(404).json({ error: 'Quote not found' });
    if (!EDITABLE_STATUSES.includes(header.status)) {
      return res.status(403).json({ error: 'Quote is locked — rates cannot be changed on accepted quotes' });
    }

    const { rows: [unit] } = await pool.query(
      'SELECT * FROM qb_quote_units WHERE id = $1 AND quote_id = $2', [unitId, id]
    );
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    // Compare stored line prices against current price list (only linked lines)
    const { rows: lines } = await pool.query(`
      SELECT l.id, l.product, l.category,
             l.price   AS stored_price,
             p.price   AS current_price
      FROM qb_quote_unit_lines l
      JOIN qb_price_list p ON l.price_list_id = p.id
      WHERE l.unit_id = $1
    `, [unitId]);

    const materialDiffs = lines
      .filter(l => Number(l.stored_price) !== Number(l.current_price))
      .map(l => ({
        line_id:       l.id,
        product:       l.product,
        category:      l.category,
        stored_price:  Number(l.stored_price),
        current_price: Number(l.current_price),
      }));

    // Compare stored labour rates against current labour_rates table
    const { rows: rateRows } = await pool.query('SELECT type, hourly_rate FROM labour_rates');
    const currentRates = Object.fromEntries(rateRows.map(r => [r.type, Number(r.hourly_rate)]));

    const LABOUR_TYPES = ['admin', 'cnc', 'edgebander', 'assembly', 'delivery', 'installation'];
    const labourDiffs = LABOUR_TYPES
      .filter(t => Number(unit[`${t}_rate`]) !== currentRates[t])
      .map(t => ({
        type:         t,
        stored_rate:  Number(unit[`${t}_rate`]),
        current_rate: currentRates[t],
      }));

    res.json({ materials: materialDiffs, labour: labourDiffs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// Applies a full rate sync to one unit: updates line prices from price list,
// updates labour rates from labour_rates table, clears override flags,
// stamps rates_last_synced_at, and triggers write-back to quotes.value.
async function syncRates(req, res) {
  const { id, unitId } = req.params;
  const client = await pool.connect();
  try {
    const { rows: [header] } = await pool.query(
      'SELECT status, quote_id, margin, waste_pct FROM qb_quote_headers WHERE id = $1', [id]
    );
    if (!header) return res.status(404).json({ error: 'Quote not found' });
    if (!EDITABLE_STATUSES.includes(header.status)) {
      return res.status(403).json({ error: 'Quote is locked — rates cannot be changed on accepted quotes' });
    }

    const { rows: [unit] } = await pool.query(
      'SELECT id FROM qb_quote_units WHERE id = $1 AND quote_id = $2', [unitId, id]
    );
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    await client.query('BEGIN');

    // Update linked line prices to current price list; clear price_overridden.
    // total is a GENERATED column (price * quantity) — omit from SET.
    await client.query(`
      UPDATE qb_quote_unit_lines l
      SET price = p.price,
          price_overridden = FALSE
      FROM qb_price_list p
      WHERE l.price_list_id = p.id
        AND l.unit_id = $1
    `, [unitId]);

    // Fetch current labour rates
    const { rows: rateRows } = await client.query('SELECT type, hourly_rate FROM labour_rates');
    const rates = Object.fromEntries(rateRows.map(r => [r.type, Number(r.hourly_rate)]));
    const R = t => rates[t] ?? 100;

    // Update all labour rates on the unit; clear override flags; stamp sync time
    await client.query(`
      UPDATE qb_quote_units
      SET admin_rate = $1, cnc_rate = $2, edgebander_rate = $3,
          assembly_rate = $4, delivery_rate = $5, installation_rate = $6,
          admin_rate_overridden        = FALSE,
          cnc_rate_overridden          = FALSE,
          edgebander_rate_overridden   = FALSE,
          assembly_rate_overridden     = FALSE,
          delivery_rate_overridden     = FALSE,
          installation_rate_overridden = FALSE,
          rates_last_synced_at = NOW()
      WHERE id = $7
    `, [R('admin'), R('cnc'), R('edgebander'), R('assembly'), R('delivery'), R('installation'), unitId]);

    // Recalculate write-back to quotes.value when linked to job tracker
    if (header.quote_id) {
      const { rows: [tot] } = await client.query(`
        SELECT COALESCE(SUM(
          (COALESCE(m.s, 0) * (1 + $2::numeric) + COALESCE(w.s, 0) +
           (u.admin_hours * u.admin_rate + u.cnc_hours * u.cnc_rate +
            u.edgebander_hours * u.edgebander_rate + u.assembly_hours * u.assembly_rate +
            u.delivery_hours * u.delivery_rate + u.installation_hours * u.installation_rate)
          ) * (1 + $3::numeric) * u.quantity
        ), 0) AS subtotal
        FROM qb_quote_units u
        LEFT JOIN (
          SELECT unit_id, SUM(total) AS s FROM qb_quote_unit_lines WHERE category = 'Materials' GROUP BY unit_id
        ) m ON m.unit_id = u.id
        LEFT JOIN (
          SELECT unit_id, SUM(total) AS s FROM qb_quote_unit_lines WHERE category = 'Hardware' GROUP BY unit_id
        ) w ON w.unit_id = u.id
        WHERE u.quote_id = $1
      `, [id, header.waste_pct, header.margin]);
      await client.query('UPDATE quotes SET value = $1 WHERE id = $2', [Number(tot.subtotal), header.quote_id]);
    }

    await client.query('COMMIT');

    const quote = await fetchFull(id);
    res.json(quote);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

// ── Job Tracker integration ───────────────────────────────────────────────

// Returns the QB header (full) linked to a job-tracker quote, or 404 if none yet.
async function getByQuoteId(req, res) {
  try {
    const { rows: [row] } = await pool.query(
      'SELECT id FROM qb_quote_headers WHERE quote_id = $1',
      [req.params.quoteId]
    );
    if (!row) return res.status(404).json({ exists: false });
    const quote = await fetchFull(row.id);
    res.json(quote);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// Idempotent: returns existing QB header if one is already linked, otherwise
// creates a new one seeded from the job-tracker quote's details.
async function createFromQuote(req, res) {
  const { quoteId } = req.params;

  // Return existing if already linked
  const { rows: [existing] } = await pool.query(
    'SELECT id FROM qb_quote_headers WHERE quote_id = $1', [quoteId]
  );
  if (existing) {
    const quote = await fetchFull(existing.id);
    return res.json(quote);
  }

  // Look up the job-tracker quote
  const { rows: [jt] } = await pool.query(
    'SELECT quote_number, client_name, project, date FROM quotes WHERE id = $1', [quoteId]
  );
  if (!jt) return res.status(404).json({ error: 'Quote not found' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const qbId = await _upsertFull(null, {
      quote_number: jt.quote_number,
      date:         jt.date,
      project:      jt.project,
      prepared_by:  null,
      margin:       0.15,
      waste_pct:    0.10,
      status:       'draft',
      notes:        null,
      client_id:    null,
      quote_id:     quoteId,
      units:        [],
    }, client);
    await client.query('COMMIT');
    const quote = await fetchFull(qbId);
    res.status(201).json(quote);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'QB header already exists for this quote' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

module.exports = {
  getNextNumber, getAll, getOne, create, update, updateStatus, remove,
  getSummary, getBudgetQty, getPdf,
  getByQuoteId, createFromQuote,
  getRateDiff, syncRates,
};
