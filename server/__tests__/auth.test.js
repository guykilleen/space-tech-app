const request = require('supertest');
const app     = require('../app');
const pool    = require('../config/db');

afterAll(() => pool.end());

// ── Login ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 200 + token for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'testpass123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ email: 'admin@test.local', role: 'admin' });
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'testpass123' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when body is missing email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'testpass123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns current user when authenticated', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'manager@test.local', password: 'testpass123' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('manager@test.local');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ── Role-based access ─────────────────────────────────────────────────────

describe('Role-based access control', () => {
  let adminToken, workshopToken;

  beforeAll(async () => {
    const [adminRes, wsRes] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'admin@test.local',    password: 'testpass123' }),
      request(app).post('/api/auth/login').send({ email: 'workshop@test.local', password: 'testpass123' }),
    ]);
    adminToken    = adminRes.body.token;
    workshopToken = wsRes.body.token;
  });

  it('admin can access GET /api/users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('workshop is forbidden from GET /api/users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${workshopToken}`);
    expect(res.status).toBe(403);
  });

  it('workshop is forbidden from POST /api/quotes', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${workshopToken}`)
      .send({ client_name: 'Should fail', quote_number: 'TST-ROLE' });
    expect(res.status).toBe(403);
  });

  it('unauthenticated request to protected route returns 401', async () => {
    const res = await request(app).get('/api/quotes');
    expect(res.status).toBe(401);
  });
});
