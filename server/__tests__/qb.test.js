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

  it('POST auto-generates a Q-NNNN quote_number when none is provided', async () => {
    const body = BODY();
    delete body.quote_number;
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body.quote_number).toMatch(/^Q-\d{4,}$/);
    // Clean up the auto-generated quote
    if (res.body.id) {
      await pool.query(`DELETE FROM qb_quote_headers WHERE id = $1`, [res.body.id]);
    }
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

// ── QB Quote number auto-generation ───────────────────────────────────────

describe('GET /api/qb/quotes/next-number', () => {
  it('returns a Q-NNNN formatted number', async () => {
    const res = await request(app)
      .get('/api/qb/quotes/next-number')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.next_number).toMatch(/^Q-\d{4,}$/);
  });

  it('increments past an existing Q- number', async () => {
    await pool.query(
      `INSERT INTO quotes (quote_number, client_name) VALUES ('Q-8801', 'TST-Bump')`
    );

    const res = await request(app)
      .get('/api/qb/quotes/next-number')
      .set('Authorization', `Bearer ${adminToken}`);

    const num = parseInt(res.body.next_number.replace('Q-', ''), 10);
    expect(num).toBeGreaterThanOrEqual(8802);

    await pool.query(`DELETE FROM quotes WHERE quote_number = 'Q-8801'`);
  });

  it('increments past a VQ- number that is higher than any Q-', async () => {
    await pool.query(
      `INSERT INTO quotes (quote_number, client_name) VALUES ('VQ-8900', 'TST-Bump')`
    );

    const res = await request(app)
      .get('/api/qb/quotes/next-number')
      .set('Authorization', `Bearer ${adminToken}`);

    const num = parseInt(res.body.next_number.replace('Q-', ''), 10);
    expect(num).toBeGreaterThanOrEqual(8901);

    await pool.query(`DELETE FROM quotes WHERE quote_number = 'VQ-8900'`);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/qb/quotes/next-number');
    expect(res.status).toBe(401);
  });
});

// ── Subtrades ──────────────────────────────────────────────────────────────

describe('Subtrades', () => {
  let qbId, unitId;

  const BASE_BODY = () => ({
    quote_number:  'TST-QB-SUBTRADE',
    date:          '2024-06-01',
    project:       'Subtrade Test',
    margin:        0.15,
    waste_pct:     0.10,
    status:        'draft',
    units: [{
      unit_number:        1,
      quantity:           2,
      admin_hours:        0,
      cnc_hours:          0,
      edgebander_hours:   0,
      assembly_hours:     0,
      delivery_hours:     0,
      installation_hours: 0,
      subtrade_margin:    0.20,
      subtrades: [{
        type: '2pac_flat', mode: 'fixed', cost: 500, quantity: 0, rate: 0,
      }],
      lines: [],
    }],
  });

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_BODY());
    qbId   = res.body.id;
    unitId = res.body.units[0].id;
  });

  afterAll(async () => {
    if (qbId) await pool.query(`DELETE FROM qb_quote_headers WHERE id = $1`, [qbId]);
  });

  it('POST with fixed-mode subtrade saves it and GET returns it', async () => {
    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const subtrades = res.body.units[0].subtrades;
    expect(Array.isArray(subtrades)).toBe(true);
    const st = subtrades.find(s => s.type === '2pac_flat');
    expect(st).toBeDefined();
    expect(st.mode).toBe('fixed');
    expect(Number(st.cost)).toBe(500);
  });

  it('PUT updates subtrade to qty_rate mode and persists correctly', async () => {
    const res = await request(app)
      .put(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...BASE_BODY(),
        units: [{
          id:             unitId,
          unit_number:    1,
          quantity:       2,
          admin_hours:    0, cnc_hours: 0, edgebander_hours: 0,
          assembly_hours: 0, delivery_hours: 0, installation_hours: 0,
          subtrade_margin: 0.20,
          subtrades: [{
            type: 'stone', mode: 'qty_rate', cost: 0, quantity: 5, rate: 80,
          }],
          lines: [],
        }],
      });

    expect(res.status).toBe(200);
    const st = res.body.units[0].subtrades.find(s => s.type === 'stone');
    expect(st).toBeDefined();
    expect(st.mode).toBe('qty_rate');
    expect(Number(st.quantity)).toBe(5);
    expect(Number(st.rate)).toBe(80);
  });

  it('zero-value subtrade is not persisted in the database', async () => {
    await request(app)
      .put(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...BASE_BODY(),
        units: [{
          id:             unitId,
          unit_number:    1,
          quantity:       2,
          admin_hours:    0, cnc_hours: 0, edgebander_hours: 0,
          assembly_hours: 0, delivery_hours: 0, installation_hours: 0,
          subtrade_margin: 0.20,
          subtrades: [{ type: 'glass', mode: 'fixed', cost: 0, quantity: 0, rate: 0 }],
          lines: [],
        }],
      });

    const { rows } = await pool.query(
      `SELECT * FROM qb_unit_subtrades WHERE unit_id = $1 AND type = 'glass'`,
      [unitId]
    );
    expect(rows).toHaveLength(0);
  });

  it('subtrade_margin is applied correctly in the unit sell calculation', async () => {
    // cost=500, unit.quantity=2, margin=20% → sell = 500 * 1.20 * 2 = 1200
    await request(app)
      .put(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...BASE_BODY(),
        units: [{
          id:             unitId,
          unit_number:    1,
          quantity:       2,
          admin_hours:    0, cnc_hours: 0, edgebander_hours: 0,
          assembly_hours: 0, delivery_hours: 0, installation_hours: 0,
          subtrade_margin: 0.20,
          subtrades: [{ type: '2pac_flat', mode: 'fixed', cost: 500, quantity: 0, rate: 0 }],
          lines: [],
        }],
      });

    const budget = await request(app)
      .get(`/api/qb/quotes/${qbId}/budget`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(budget.status).toBe(200);
    // total_cost = 500 * 2 = 1000; total_sell = 500 * 1.20 * 2 = 1200
    const st = budget.body.subtrades.find(s => s.type === '2pac_flat');
    expect(st).toBeDefined();
    expect(Number(st.total_cost)).toBeCloseTo(1000, 1);
    expect(Number(st.total_sell)).toBeCloseTo(1200, 1);
  });

  it('returns 401 without a token on GET /:id', async () => {
    const res = await request(app).get(`/api/qb/quotes/${qbId}`);
    expect(res.status).toBe(401);
  });
});

// ── Status sync — QB accepts/declines syncs to JT quote ───────────────────

describe('PATCH /api/qb/quotes/:id/status (status sync)', () => {
  let qbId, linkedJtId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        quote_number:  'TST-QB-STATUS',
        date:          '2024-06-01',
        project:       'Status Sync Test',
        margin:        0.15,
        waste_pct:     0.10,
        status:        'draft',
        units: [],
      });
    qbId       = res.body.id;
    linkedJtId = res.body.quote_id;
  });

  afterAll(async () => {
    if (qbId) await pool.query(`DELETE FROM qb_quote_headers WHERE id = $1`, [qbId]);
  });

  it('accepting a QB quote syncs the linked JT quote to accepted', async () => {
    const res = await request(app)
      .patch(`/api/qb/quotes/${qbId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');

    const { rows: [jt] } = await pool.query(
      'SELECT status FROM quotes WHERE id = $1', [linkedJtId]
    );
    expect(jt.status).toBe('accepted');
  });

  it('sending syncs JT quote to sent status', async () => {
    const res = await request(app)
      .patch(`/api/qb/quotes/${qbId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'sent' });

    expect(res.status).toBe(200);

    const { rows: [jt] } = await pool.query(
      'SELECT status FROM quotes WHERE id = $1', [linkedJtId]
    );
    expect(jt.status).toBe('sent');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .patch(`/api/qb/quotes/${qbId}/status`)
      .send({ status: 'draft' });
    expect(res.status).toBe(401);
  });
});

// ── Budget Quantities ──────────────────────────────────────────────────────

describe('GET /api/qb/quotes/:id/budget', () => {
  let qbId, unitId;

  // Quote: 1 unit, qty=1, admin_hours=2 @ $100, 1 material line price=$40 qty=3
  // margin=0.10, waste_pct=0.05
  // mat_raw = 40*3 = 120; waste = 6; mat+waste = 126
  // labour = 2*1*100 = 200; costs_total = 326; margin_amt = 32.6
  // subtotal = 358.6; gst = 35.86; total = 394.46
  const BODY = () => ({
    quote_number:  'TST-QB-BUDGET',
    date:          '2024-06-01',
    project:       'Budget Test',
    margin:        0.10,
    waste_pct:     0.05,
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
      subtrade_margin:    0,
      subtrades:          [],
      lines: [{
        price_list_id:   plItemId,
        category:        'Materials',
        product:         'TST-Substrate',
        price:           40,
        unit_of_measure: 'sheet',
        quantity:        3,
      }],
    }],
  });

  beforeAll(async () => {
    // Ensure admin rate is 100 for predictable labour cost
    await pool.query(`UPDATE labour_rates SET hourly_rate = 100 WHERE type = 'admin'`);
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BODY());
    qbId   = res.body.id;
    unitId = res.body.units[0].id;
  });

  afterAll(async () => {
    if (qbId) await pool.query(`DELETE FROM qb_quote_headers WHERE id = $1`, [qbId]);
    await pool.query(`UPDATE labour_rates SET hourly_rate = 100 WHERE type = 'admin'`);
  });

  it('returns correct aggregated materials totals', async () => {
    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/budget`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const mat = res.body.lines.find(l => l.category === 'Materials');
    expect(mat).toBeDefined();
    expect(Number(mat.total_qty)).toBeCloseTo(3, 2);          // 3 * unit_qty 1
    expect(Number(mat.total_cost_allowed)).toBeCloseTo(120, 2); // 40 * 3

    expect(Number(res.body.totals.materials_raw)).toBeCloseTo(120, 2);
    expect(Number(res.body.totals.waste_amount)).toBeCloseTo(6, 2);  // 120 * 0.05
    expect(Number(res.body.totals.materials)).toBeCloseTo(126, 2);
  });

  it('returns correct labour totals', async () => {
    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/budget`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(Number(res.body.labour.admin_hours)).toBeCloseTo(2, 2); // 2h * unit_qty 1
    expect(Number(res.body.labour.admin_cost)).toBeCloseTo(200, 2); // 2 * 1 * $100
    expect(Number(res.body.totals.labour)).toBeCloseTo(200, 2);
  });

  it('returns correct overall totals including margin, GST', async () => {
    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/budget`)
      .set('Authorization', `Bearer ${adminToken}`);

    const t = res.body.totals;
    expect(Number(t.costs_total)).toBeCloseTo(326, 1);    // 126 + 200
    expect(Number(t.margin_amount)).toBeCloseTo(32.6, 1); // 326 * 0.10
    expect(Number(t.subtotal)).toBeCloseTo(358.6, 1);
    expect(Number(t.gst)).toBeCloseTo(35.86, 1);
    expect(Number(t.total)).toBeCloseTo(394.46, 1);
  });

  it('includes subtrades in totals when present', async () => {
    // Add a fixed subtrade: cost=300, margin=25%, unit.qty=1
    // total_cost = 300; total_sell = 300 * 1.25 = 375
    const lineRes = await request(app)
      .get(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const lineId = lineRes.body.units[0].lines[0].id;

    await request(app)
      .put(`/api/qb/quotes/${qbId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...BODY(),
        units: [{
          id:             unitId,
          unit_number:    1,
          quantity:       1,
          admin_hours:    2,
          cnc_hours:      0, edgebander_hours: 0, assembly_hours: 0,
          delivery_hours: 0, installation_hours: 0,
          subtrade_margin: 0.25,
          subtrades: [{ type: 'stone', mode: 'fixed', cost: 300, quantity: 0, rate: 0 }],
          lines: [{ id: lineId, price_list_id: plItemId, category: 'Materials',
                    product: 'TST-Substrate', price: 40, quantity: 3 }],
        }],
      });

    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/budget`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const st = res.body.subtrades.find(s => s.type === 'stone');
    expect(st).toBeDefined();
    expect(Number(st.total_cost)).toBeCloseTo(300, 1);
    expect(Number(st.total_sell)).toBeCloseTo(375, 1);
    // subtotal should include subtrades_sell
    expect(Number(res.body.totals.subtrades_sell)).toBeCloseTo(375, 1);
    expect(Number(res.body.totals.subtotal)).toBeCloseTo(358.6 + 375, 1);
  });

  it('returns all-zero totals for a quote with no lines or subtrades', async () => {
    const emptyRes = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        quote_number: 'TST-QB-EMPTY',
        date:         '2024-06-01',
        margin:       0.15,
        waste_pct:    0.10,
        status:       'draft',
        units: [{ unit_number: 1, quantity: 1, admin_hours: 0, cnc_hours: 0,
                  edgebander_hours: 0, assembly_hours: 0, delivery_hours: 0,
                  installation_hours: 0, subtrade_margin: 0, subtrades: [], lines: [] }],
      });

    const res = await request(app)
      .get(`/api/qb/quotes/${emptyRes.body.id}/budget`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(0);
    expect(Number(res.body.totals.materials_raw)).toBe(0);
    expect(Number(res.body.totals.labour)).toBe(0);
    expect(Number(res.body.totals.subtotal)).toBe(0);

    await pool.query(`DELETE FROM qb_quote_headers WHERE id = $1`, [emptyRes.body.id]);
  });

  it('returns 404 for an unknown quote id', async () => {
    const res = await request(app)
      .get('/api/qb/quotes/00000000-0000-0000-0000-000000000000/budget')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get(`/api/qb/quotes/${qbId}/budget`);
    expect(res.status).toBe(401);
  });
});

// ── PDF generation ────────────────────────────────────────────────────────

describe('GET /api/qb/quotes/:id/pdf', () => {
  let qbId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/qb/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        quote_number:  'TST-QB-PDF',
        date:          '2024-06-01',
        project:       'PDF Smoke Test',
        prepared_by:   'Tester',
        margin:        0.15,
        waste_pct:     0.10,
        status:        'draft',
        units: [{
          unit_number:        1,
          description:        'Test cabinet',
          quantity:           1,
          admin_hours:        1,
          cnc_hours:          0,
          edgebander_hours:   0,
          assembly_hours:     0,
          delivery_hours:     0,
          installation_hours: 0,
          subtrade_margin:    0,
          subtrades:          [],
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
    qbId = res.body.id;
  });

  afterAll(async () => {
    if (qbId) await pool.query(`DELETE FROM qb_quote_headers WHERE id = $1`, [qbId]);
  });

  it('returns a non-empty PDF buffer with correct content-type', async () => {
    const res = await request(app)
      .get(`/api/qb/quotes/${qbId}/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.body.length).toBeGreaterThan(1000); // any real PDF is > 1 KB
  }, 30000);

  it('returns 401 without a token', async () => {
    const res = await request(app).get(`/api/qb/quotes/${qbId}/pdf`);
    expect(res.status).toBe(401);
  });
});
