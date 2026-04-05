const request = require('supertest');
const app     = require('../app');
const pool    = require('../config/db');

let adminToken;
let quoteId;
let jobId;

beforeAll(async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.local', password: 'testpass123' });
  adminToken = loginRes.body.token;

  // Create a prerequisite quote for job tests
  const quoteRes = await request(app)
    .post('/api/quotes')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      quote_number: 'TST-JQ01',
      client_name:  'Jobs Test Client',
      project:      'Jobs Test Project',
      date:         '2024-06-01',
      status:       'accepted',
    });
  quoteId = quoteRes.body.id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM jobs   WHERE job_number  LIKE 'TST-%' OR client_name = 'Jobs Test Client'`);
  await pool.query(`DELETE FROM quotes WHERE quote_number LIKE 'TST-%'`);
  await pool.end();
});

// ── Create ────────────────────────────────────────────────────────────────

describe('POST /api/jobs', () => {
  it('admin can create a job and gets 201', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        job_number:   'TST-001',
        quote_id:     quoteId,
        quote_number: 'TST-JQ01',
        client_name:  'Jobs Test Client',
        project:      'Jobs Test Project',
        hours_admin:  2,
        hours_machining: 8,
      });

    expect(res.status).toBe(201);
    expect(res.body.client_name).toBe('Jobs Test Client');
    expect(res.body).toHaveProperty('id');
    jobId = res.body.id;
  });

  it('returns 400 when client_name is missing', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ job_number: 'TST-002' }); // no client_name

    expect(res.status).toBe(400);
  });

  it('workshop cannot create a job', async () => {
    const wsRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'workshop@test.local', password: 'testpass123' });

    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${wsRes.body.token}`)
      .send({ job_number: 'TST-003', client_name: 'Should fail' });

    expect(res.status).toBe(403);
  });
});

// ── Read ──────────────────────────────────────────────────────────────────

describe('GET /api/jobs', () => {
  it('returns array of jobs', async () => {
    const res = await request(app)
      .get('/api/jobs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes the created job in the list', async () => {
    const res = await request(app)
      .get('/api/jobs')
      .set('Authorization', `Bearer ${adminToken}`);

    const found = res.body.find(j => j.job_number === 'TST-001');
    expect(found).toBeDefined();
    expect(found.client_name).toBe('Jobs Test Client');
  });

  it('GET /api/jobs/:id returns the job', async () => {
    const res = await request(app)
      .get(`/api/jobs/${jobId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
  });

  it('GET /api/jobs/:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/jobs/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it('workshop can view jobs list', async () => {
    const wsRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'workshop@test.local', password: 'testpass123' });

    const res = await request(app)
      .get('/api/jobs')
      .set('Authorization', `Bearer ${wsRes.body.token}`);

    expect(res.status).toBe(200);
  });
});
