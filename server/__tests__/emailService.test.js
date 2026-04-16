const { buildJobCsv } = require('../services/emailService');

// buildJobCsv is a pure function — no DB, no Resend, no mocking needed

function parseRows(csv) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  const values  = lines[1].split(',');
  const obj = {};
  headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
  return obj;
}

describe('buildJobCsv', () => {
  const baseJob = {
    job_number:      '511',
    project:         'Kitchen Renovation',
    client_name:     'Acme Joinery',
    wip_due:         '2025-08-15',
    hours_admin:     2,
    hours_machining: 6,
    hours_assembly:  4,
    hours_delivery:  1,
    hours_install:   3,
    quote_id:        'some-uuid',
  };

  it('outputs the correct CSV headers', () => {
    const csv = buildJobCsv(baseJob, {});
    const firstLine = csv.split('\n')[0];
    expect(firstLine).toBe(
      'project_name,location,client_name,client_email,client_phone,' +
      'start_date,due_date,estimated_installation_date,' +
      'administration_hours,production_hours,assembly_hours,' +
      'delivery_dispatch_installation_hours,description,notes,status'
    );
  });

  it('maps job fields to the correct columns', () => {
    const row = parseRows(buildJobCsv(baseJob, { email: 'bob@acme.com', phone: '0412345678' }));
    expect(row.project_name).toBe('Kitchen Renovation');
    expect(row.client_name).toBe('Acme Joinery');
    expect(row.client_email).toBe('bob@acme.com');
    expect(row.client_phone).toBe('0412345678');
    expect(row.status).toBe('future');
  });

  it('formats due_date as DD/MM/YYYY', () => {
    const row = parseRows(buildJobCsv(baseJob, {}));
    expect(row.due_date).toBe('15/08/2025');
    expect(row.estimated_installation_date).toBe('15/08/2025');
  });

  it('combines machining + assembly into production_hours', () => {
    const row = parseRows(buildJobCsv(baseJob, {}));
    // 6 + 4 = 10
    expect(row.production_hours).toBe('10');
  });

  it('keeps assembly_hours separate', () => {
    const row = parseRows(buildJobCsv(baseJob, {}));
    expect(row.assembly_hours).toBe('4');
  });

  it('combines delivery + install into delivery_dispatch_installation_hours', () => {
    const row = parseRows(buildJobCsv(baseJob, {}));
    // 1 + 3 = 4
    expect(row.delivery_dispatch_installation_hours).toBe('4');
  });

  it('leaves location, start_date, description, notes blank', () => {
    const row = parseRows(buildJobCsv(baseJob, {}));
    expect(row.location).toBe('');
    expect(row.start_date).toBe('');
    expect(row.description).toBe('');
    expect(row.notes).toBe('');
  });

  it('leaves client_email and client_phone blank when no contact provided', () => {
    const row = parseRows(buildJobCsv(baseJob, {}));
    expect(row.client_email).toBe('');
    expect(row.client_phone).toBe('');
  });

  it('leaves client_email and client_phone blank for jobs with no quote link', () => {
    const jobNoQuote = { ...baseJob, quote_id: null };
    const row = parseRows(buildJobCsv(jobNoQuote));
    expect(row.client_email).toBe('');
    expect(row.client_phone).toBe('');
  });

  it('wraps project_name in quotes when it contains a comma', () => {
    const job = { ...baseJob, project: 'Smith, John - Kitchen' };
    const csv = buildJobCsv(job, {});
    expect(csv).toContain('"Smith, John - Kitchen"');
    // Verify it still parses correctly
    const lines = csv.trim().split('\n');
    // Use a proper CSV split that respects quoted fields
    expect(lines[1]).toMatch(/^"Smith, John - Kitchen"/);
  });

  it('returns blank date fields when wip_due is null', () => {
    const job = { ...baseJob, wip_due: null };
    const row = parseRows(buildJobCsv(job, {}));
    expect(row.due_date).toBe('');
    expect(row.estimated_installation_date).toBe('');
  });

  it('handles zero hours gracefully', () => {
    const job = { ...baseJob, hours_machining: 0, hours_assembly: 0, hours_delivery: 0, hours_install: 0 };
    const row = parseRows(buildJobCsv(job, {}));
    expect(row.production_hours).toBe('0');
    expect(row.delivery_dispatch_installation_hours).toBe('0');
  });

  it('formats fractional hours with one decimal place', () => {
    const job = { ...baseJob, hours_admin: 1.5 };
    const row = parseRows(buildJobCsv(job, {}));
    expect(row.administration_hours).toBe('1.5');
  });
});
