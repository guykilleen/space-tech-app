const request = require('supertest');
const app     = require('../app');
const pool    = require('../config/db');

let adminToken;
let quoteId;

const QUOTE = {
  quote_number: 'TST-Q001',
  client_name:  'Jest Test Client',
  project:      'Jest Test Project',
  date:         '2024-06-01',
  initials:     'JT',
  value:        12500,
  status:       'draft',
};

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.local', password: 'testpass123' });
  adminToken = res.body.token;
});

afterAll(async () => {
  await pool.query(`DELETE FROM quotes WHERE quote_number LIKE 'TST-%'`);
  await pool.end();
});

// ── Create ────────────────────────────────────────────────────────────────

describe('POST /api/quotes', () => {
  it('admin can create a quote and gets 201', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(QUOTE);

    expect(res.status).toBe(201);
    expect(res.body.quote_number).toBe('TST-Q001');
    expect(res.body.client_name).toBe('Jest Test Client');
    expect(res.body).toHaveProperty('id');
    quoteId = res.body.id;
  });

  it('returns 400 when client_name is missing', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quote_number: 'TST-Q002' }); // no client_name

    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate quote_number', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(QUOTE); // same quote_number as above

    expect(res.status).toBe(409);
  });
});

// ── Read ──────────────────────────────────────────────────────────────────

describe('GET /api/quotes', () => {
  it('returns array of quotes', async () => {
    const res = await request(app)
      .get('/api/quotes')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes the created quote in the list', async () => {
    const res = await request(app)
      .get('/api/quotes')
      .set('Authorization', `Bearer ${adminToken}`);

    const found = res.body.find(q => q.quote_number === 'TST-Q001');
    expect(found).toBeDefined();
  });

  it('GET /api/quotes/:id returns the quote', async () => {
    const res = await request(app)
      .get(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(quoteId);
    expect(res.body.client_name).toBe('Jest Test Client');
  });

  it('GET /api/quotes/:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/quotes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it('workshop can view quotes list', async () => {
    const wsRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'workshop@test.local', password: 'testpass123' });

    const res = await request(app)
      .get('/api/quotes')
      .set('Authorization', `Bearer ${wsRes.body.token}`);

    expect(res.status).toBe(200);
  });
});

// ── Status update ─────────────────────────────────────────────────────────

describe('PATCH /api/quotes/:id/status', () => {
  it('accepts each valid status value', async () => {
    for (const status of ['draft', 'sent', 'accepted']) {
      const res = await request(app)
        .patch(`/api/quotes/${quoteId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
  });

  it.each(['pending', 'review', 'declined', 'submitted', 'locked'])(
    'rejects old status "%s" with 400',
    async (status) => {
      const res = await request(app)
        .patch(`/api/quotes/${quoteId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });
      expect(res.status).toBe(400);
    }
  );

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .patch(`/api/quotes/${quoteId}/status`)
      .send({ status: 'sent' });
    expect(res.status).toBe(401);
  });
});

// ── Next number ───────────────────────────────────────────────────────────

describe('GET /api/quotes/next-number', () => {
  it('returns a formatted quote number', async () => {
    const res = await request(app)
      .get('/api/quotes/next-number')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('next_number');
    expect(res.body.next_number).toMatch(/^Q-\d{4,}$/);
  });
});
