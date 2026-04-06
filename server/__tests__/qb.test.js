const request = require('supertest');
const app  = require('../app');
const pool = require('../config/db');

let adminToken, workshopToken;
let plItemId;     // qb_price_list row used for rate-diff tests
let jtQuoteId;    // job-tracker quotes.id for integration tests

// ── Shared setup ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const [adminRes, wsRes] = await Promise.all([
    request(app).post('/api/auth/login').send({ email: 'admin@test.local',    password: 'testpass123' }),
    request(app).post('/api/auth/login').send({ email: 'workshop@test.local', password: 'testpass123' }),
  ]);
  adminToken    = adminRes.body.token;
  workshopToken = wsRes.body.token;

  // Seed a price list item directly — used in rate-diff / sync-rates tests
  const pl = await pool.query(`
    INSERT INTO qb_price_list (category, product, price, unit, active)
    VALUES ('Materials', 'TST-Substrate', 40.00, 'sheet', true)
    RETURNING id
  `);
  plItemId = pl.rows[0].id;

  // Seed a job-tracker quote for integration tests
  const jt = await pool.query(`
    INSERT INTO quotes (quote_number, client_name, project, status)
    VALUES ('TST-JT-001', 'Test JT Client', 'JT Project', 'pending')
    RETURNING id
  `);
  jtQuoteId = jt.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM qb_quote_headers WHERE quote_number LIKE 'TST-%'`);
  await pool.query(`DELETE FROM qb_price_list   WHERE product = 'TST-Substrate'`);
  await pool.query(`DELETE FROM quotes           WHERE quote_number = 'TST-JT-001'`);
  // Restore admin labour rate in case a test changed it
  await pool.query(`UPDATE labour_rates SET hourly_rate = 100 WHERE type = 'admin'`);
  await pool.end();
});

// ── Labour rates ───────────────────────────────────────────────────────────

describe('GET /api/qb/labour-rates', () => {
  it('returns all 6 types at their current rates', async () => {
    const res = await request(app)
      .get('/api/qb/labour-rates')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const types = ['admin', 'cnc', 'edgebander', 'assembly', 'delivery', 'installation'];
    types.forEach(t => expect(res.body).toHaveProperty(t));
  });

  it('workshop cannot access labour rates', async () => {
    const res = await request(app)
      .get('/api/qb/labour-rates')
      .set('Authorization', `Bearer ${workshopToken}`);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/qb/labour-rates/:type', () => {
  it('updates a labour rate and the new value is returned by GET', async () => {
    await request(app)
      .patch('/api/qb/labour-rates/cnc')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hourly_rate: 115 });

    const res = await request(app)
      .get('/api/qb/labour-rates')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(Number(res.body.cnc)).toBe(115);

    // Restore
    await request(app)
      .patch('/api/qb/labour-rates/cnc')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hourly_rate: 100 });
  });
});

// ── QB Quote CRUD ──────────────────────────────────────────────────────────

describe('QB Quote CRUD', () => {
  let qbId, unitId, lineId;

  const BODY = () => ({
    quote_number: 'TST-QB-001',
    date:         '2024-01-15',
    project:      'Test Joinery Project',
    prepared_by:  'Tester',
    margin:       0.15,
    waste_pct:    0.10,
    status:       'draft',
    units: [{
      unit_number:        1,
      drawing_number:     'D.01',
      room_number:        'Kitchen',
      level:              'L1',
      description:        'Base cabinets',
      quantity:           2,
      admin_hours:        1,
      cnc_hours:          2,
      edgebander_hours:   0.5,
      assembly_hours:     3,
      delivery_hours:     0.5,
      installation_hours: 1,
      lines: [{
        price_list_id:   plItemId,
        category:        'Materials',
        product:         'TST-Substrate',
        price:           40,
        unit_of_measure: 'sheet',
        quantity:        4,
      }],
    }],
  });

  it('POST creates a quote and returns 201 with nested structure', async () => {
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BODY());

    expect(res.status).toBe(201);
    expect(res.body.quote_number).toBe('TST-QB-001');
    expect(res.body.units).toHaveLength(1);
    expect(res.body.units[0].lines).toHaveLength(1);

    qbId   = res.body.id;
    unitId = res.body.units[0].id;
    lineId = res.body.units[0].lines[0].id;
  });

  it('POST snapshots current labour rates onto the new unit', async () => {
    const { rows: [unit] } = await pool.query(
      'SELECT admin_rate, cnc_rate, delivery_rate FROM qb_quote_units WHERE id = $1',
      [unitId]
    );
    expect(Number(unit.admin_rate)).toBe(100);
    expect(Number(unit.cnc_rate)).toBe(100);
    expect(Number(unit.delivery_rate)).toBe(100);
  });

  it('POST returns 400 when quote_number is missing', async () => {
    const body = BODY();
    delete body.quote_number;
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).toBe(400);
  });

  it('POST returns 409 on duplicate quote_number', async () => {
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BODY());
    expect(res.status).toBe(409);
  });

  it('GET list includes the created quote', async () => {
    const res = await request(app)
      .get('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find(q => q.id === qbId)).toBeDefined();
  });

  it('GET /:id returns full nested quote', async () => {
    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(qbId);
    expect(res.body.units[0].lines[0].product).toBe('TST-Substrate');
  });

  it('GET /:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/qb/quotes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('PUT updates hours but preserves rate snapshot on existing unit', async () => {
    // Change a labour rate globally
    await pool.query(`UPDATE labour_rates SET hourly_rate = 150 WHERE type = 'admin'`);

    const res = await request(app)
      .put(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...BODY(),
        units: [{
          id:                 unitId,
          unit_number:        1,
          drawing_number:     'D.01',
          room_number:        'Kitchen',
          level:              'L1',
          description:        'Base cabinets',
          quantity:           2,
          admin_hours:        2,   // changed
          cnc_hours:          2,
          edgebander_hours:   0.5,
          assembly_hours:     3,
          delivery_hours:     0.5,
          installation_hours: 1,
          lines: [{
            id: lineId,
            price_list_id:   plItemId,
            category:        'Materials',
            product:         'TST-Substrate',
            price:           40,
            unit_of_measure: 'sheet',
            quantity:        4,
          }],
        }],
      });

    expect(res.status).toBe(200);

    // Rate snapshot on existing unit must stay at 100, not updated to 150
    const { rows: [unit] } = await pool.query(
      'SELECT admin_rate, admin_hours FROM qb_quote_units WHERE id = $1',
      [unitId]
    );
    expect(Number(unit.admin_rate)).toBe(100);   // snapshot preserved
    expect(Number(unit.admin_hours)).toBe(2);    // hours updated

    // Restore rate
    await pool.query(`UPDATE labour_rates SET hourly_rate = 100 WHERE type = 'admin'`);
  });

  it('PUT with explicit rate override stores the new rate and sets overridden flag', async () => {
    const res = await request(app)
      .put(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...BODY(),
        units: [{
          id:                   unitId,
          unit_number:          1,
          quantity:             2,
          admin_hours:          2,
          cnc_hours:            2,
          edgebander_hours:     0.5,
          assembly_hours:       3,
          delivery_hours:       0.5,
          installation_hours:   1,
          admin_rate:           85,           // manual override
          admin_rate_overridden: true,
          lines: [{
            id: lineId,
            price_list_id: plItemId,
            category:      'Materials',
            product:       'TST-Substrate',
            price:         40,
            quantity:      4,
          }],
        }],
      });

    expect(res.status).toBe(200);

    const { rows: [unit] } = await pool.query(
      'SELECT admin_rate, admin_rate_overridden FROM qb_quote_units WHERE id = $1',
      [unitId]
    );
    expect(Number(unit.admin_rate)).toBe(85);
    expect(unit.admin_rate_overridden).toBe(true);
  });

  it('DELETE removes the quote and returns success', async () => {
    // Create a throwaway quote to delete
    const cr = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...BODY(), quote_number: 'TST-QB-DEL' });

    const delRes = await request(app)
      .delete(`/api/qb/quotes/${cr.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);

    const check = await request(app)
      .get(`/api/qb/quotes/${cr.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(check.status).toBe(404);
  });

  it('workshop cannot create a QB quote', async () => {
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${workshopToken}`)
      .send(BODY());
    expect(res.status).toBe(403);
  });
});

// ── Rate diff and sync ─────────────────────────────────────────────────────

describe('Rate diff and sync', () => {
  let qbId, unitId, lineId;

  beforeAll(async () => {
    // Ensure rates are at $100 for this suite
    await pool.query(`UPDATE labour_rates SET hourly_rate = 100`);

    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        quote_number:  'TST-QB-DIFF',
        date:          '2024-01-15',
        project:       'Rate Diff Test',
        margin:        0.15,
        waste_pct:     0.10,
        status:        'draft',
        units: [{
          unit_number:        1,
          quantity:           1,
          admin_hours:        2,
          cnc_hours:          1,
          edgebander_hours:   0,
          assembly_hours:     0,
          delivery_hours:     0,
          installation_hours: 0,
          lines: [{
            price_list_id:   plItemId,
            category:        'Materials',
            product:         'TST-Substrate',
            price:           40,
            unit_of_measure: 'sheet',
            quantity:        2,
          }],
        }],
      });

    qbId   = res.body.id;
    unitId = res.body.units[0].id;
    lineId = res.body.units[0].lines[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM qb_quote_headers WHERE id = $1`, [qbId]);
    await pool.query(`UPDATE labour_rates SET hourly_rate = 100`);
    await pool.query(`UPDATE qb_price_list SET price = 40 WHERE id = $1`, [plItemId]);
  });

  it('rate-diff returns empty arrays when rates match the snapshot', async () => {
    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/units/${unitId}/rate-diff`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.materials).toHaveLength(0);
    expect(res.body.labour).toHaveLength(0);
  });

  it('rate-diff shows changed labour rates only', async () => {
    await pool.query(`UPDATE labour_rates SET hourly_rate = 125 WHERE type = 'admin'`);

    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/units/${unitId}/rate-diff`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.labour).toHaveLength(1);
    expect(res.body.labour[0].type).toBe('admin');
    expect(Number(res.body.labour[0].stored_rate)).toBe(100);
    expect(Number(res.body.labour[0].current_rate)).toBe(125);
    expect(res.body.materials).toHaveLength(0);
  });

  it('rate-diff shows changed material prices only', async () => {
    // Reset labour rate, change material price instead
    await pool.query(`UPDATE labour_rates SET hourly_rate = 100 WHERE type = 'admin'`);
    await pool.query(`UPDATE qb_price_list SET price = 55 WHERE id = $1`, [plItemId]);

    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/units/${unitId}/rate-diff`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.materials).toHaveLength(1);
    expect(res.body.materials[0].product).toBe('TST-Substrate');
    expect(Number(res.body.materials[0].stored_price)).toBe(40);
    expect(Number(res.body.materials[0].current_price)).toBe(55);
    expect(res.body.labour).toHaveLength(0);

    // Reset price for sync test below
    await pool.query(`UPDATE qb_price_list SET price = 40 WHERE id = $1`, [plItemId]);
  });

  it('rate-diff returns 403 on accepted quotes', async () => {
    await pool.query(
      `UPDATE qb_quote_headers SET status = 'accepted' WHERE id = $1`, [qbId]
    );

    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/units/${unitId}/rate-diff`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(403);

    await pool.query(
      `UPDATE qb_quote_headers SET status = 'draft' WHERE id = $1`, [qbId]
    );
  });

  it('sync-rates updates labour rates, clears override flags, stamps synced_at', async () => {
    // Set labour rates above snapshot
    await pool.query(`UPDATE labour_rates SET hourly_rate = 130 WHERE type = 'admin'`);
    // Set an override flag to confirm it's cleared
    await pool.query(
      `UPDATE qb_quote_units SET admin_rate_overridden = TRUE WHERE id = $1`, [unitId]
    );

    const res = await request(app)
      .post(`/api/qb/quotes/${qbId}/units/${unitId}/sync-rates`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    const { rows: [unit] } = await pool.query(
      `SELECT admin_rate, admin_rate_overridden, rates_last_synced_at
       FROM qb_quote_units WHERE id = $1`,
      [unitId]
    );
    expect(Number(unit.admin_rate)).toBe(130);
    expect(unit.admin_rate_overridden).toBe(false);
    expect(unit.rates_last_synced_at).not.toBeNull();
  });

  it('sync-rates updates linked material line prices', async () => {
    await pool.query(`UPDATE qb_price_list SET price = 60 WHERE id = $1`, [plItemId]);

    await request(app)
      .post(`/api/qb/quotes/${qbId}/units/${unitId}/sync-rates`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { rows: [line] } = await pool.query(
      `SELECT price, price_overridden FROM qb_quote_unit_lines WHERE id = $1`,
      [lineId]
    );
    expect(Number(line.price)).toBe(60);
    expect(line.price_overridden).toBe(false);
  });

  it('sync-rates returns 403 on accepted quotes', async () => {
    await pool.query(
      `UPDATE qb_quote_headers SET status = 'accepted' WHERE id = $1`, [qbId]
    );

    const res = await request(app)
      .post(`/api/qb/quotes/${qbId}/units/${unitId}/sync-rates`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
  });
});

// ── Job Tracker integration ────────────────────────────────────────────────

describe('Job Tracker integration', () => {
  let qbFromJtId;

  afterAll(async () => {
    if (qbFromJtId) {
      await pool.query(`DELETE FROM qb_quote_headers WHERE id = $1`, [qbFromJtId]);
    }
  });

  it('POST /from-quote/:quoteId creates a linked QB header', async () => {
    const res = await request(app)
      .post(`/api/qb/quotes/from-quote/${jtQuoteId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(201);
    expect(res.body.quote_number).toBe('TST-JT-001');
    expect(res.body.quote_id).toBe(jtQuoteId);
    qbFromJtId = res.body.id;
  });

  it('POST /from-quote/:quoteId is idempotent — returns same header on second call', async () => {
    const res = await request(app)
      .post(`/api/qb/quotes/from-quote/${jtQuoteId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(qbFromJtId);
  });

  it('GET /by-quote/:quoteId finds the linked QB header', async () => {
    const res = await request(app)
      .get(`/api/qb/quotes/by-quote/${jtQuoteId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(qbFromJtId);
  });

  it('saving a linked QB quote writes calculated value back to quotes.value', async () => {
    // Save a quote with one unit: 2 admin hours @ $100/hr, margin 15%, waste 10%, qty 1
    // Materials subtotal = 0, labour = 2 * 100 = 200
    // Unit cost = (0 * 1.10 + 200) * 1.15 = 230
    // Subtotal ex-GST = 230 * 1 (qty) = 230
    await request(app)
      .put(`/api/qb/quotes/${qbFromJtId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        quote_number:  'TST-JT-001',
        date:          '2024-01-15',
        margin:        0.15,
        waste_pct:     0.10,
        status:        'draft',
        units: [{
          unit_number:        1,
          quantity:           1,
          admin_hours:        2,
          cnc_hours:          0,
          edgebander_hours:   0,
          assembly_hours:     0,
          delivery_hours:     0,
          installation_hours: 0,
          lines: [],
        }],
      });

    const { rows: [jt] } = await pool.query(
      'SELECT value FROM quotes WHERE id = $1', [jtQuoteId]
    );
    // value should be ex-GST subtotal = 230
    expect(Number(jt.value)).toBeCloseTo(230, 1);
  });

  it('GET /by-quote/:quoteId returns 404 when no QB header is linked', async () => {
    // Create a JT quote with no QB header
    const { rows: [q] } = await pool.query(`
      INSERT INTO quotes (quote_number, client_name) VALUES ('TST-JT-NONE', 'Nobody')
      RETURNING id
    `);
    const res = await request(app)
      .get(`/api/qb/quotes/by-quote/${q.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    await pool.query(`DELETE FROM quotes WHERE id = $1`, [q.id]);
  });
});
