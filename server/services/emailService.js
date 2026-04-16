const { Resend } = require('resend');
const pool = require('../config/db');

async function getProductionManagerEmail() {
  const name = process.env.PRODUCTION_MANAGER_NAME;
  if (!name) {
    console.warn('[emailService] PRODUCTION_MANAGER_NAME not set — skipping email');
    return null;
  }
  const { rows } = await pool.query(
    'SELECT email FROM qb_contacts WHERE name ILIKE $1 LIMIT 1',
    [name]
  );
  if (!rows[0]?.email) {
    console.warn(`[emailService] No email found for contact "${name}" — skipping email`);
    return null;
  }
  return rows[0].email;
}

function formatHours(val) {
  const n = parseFloat(val) || 0;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function formatDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// DD/MM/YYYY format for CSV
function formatDateCsv(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) return '';
  const day   = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year  = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function csvCell(val) {
  const s = val == null ? '' : String(val);
  // Wrap in quotes if the value contains a comma, quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildJobCsv(job, contact = {}) {
  const dueDate = formatDateCsv(job.wip_due);
  const productionHours  = (parseFloat(job.hours_machining) || 0) + (parseFloat(job.hours_assembly)  || 0);
  const deliveryInstHours = (parseFloat(job.hours_delivery)  || 0) + (parseFloat(job.hours_install)   || 0);

  const headers = [
    'project_name', 'location', 'client_name', 'client_email', 'client_phone',
    'start_date', 'due_date', 'estimated_installation_date',
    'administration_hours', 'production_hours', 'assembly_hours',
    'delivery_dispatch_installation_hours', 'description', 'notes', 'status',
  ];

  const values = [
    job.project       || '',
    '',                                          // location — blank
    job.client_name   || '',
    contact.email     || '',
    contact.phone     || '',
    '',                                          // start_date — blank
    dueDate,
    dueDate,                                     // estimated_installation_date = due_date
    formatHours(job.hours_admin),
    formatHours(productionHours),
    formatHours(job.hours_assembly),
    formatHours(deliveryInstHours),
    '',                                          // description — blank
    '',                                          // notes — blank
    'future',
  ];

  return headers.map(csvCell).join(',') + '\n' + values.map(csvCell).join(',') + '\n';
}

async function sendJobNotification(job) {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn('[emailService] RESEND_API_KEY not set — skipping email');
      return;
    }
    const toEmail = await getProductionManagerEmail();
    if (!toEmail) return;

    // Fetch contact details (email + phone) via the linked QB quote, if available
    let contact = {};
    if (job.quote_id) {
      const { rows: cRows } = await pool.query(
        `SELECT c.email, c.phone
         FROM qb_quote_headers h
         JOIN qb_contacts c ON c.id = h.client_id
         WHERE h.quote_id = $1
         LIMIT 1`,
        [job.quote_id]
      );
      if (cRows[0]) contact = cRows[0];
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const totalHours =
      (parseFloat(job.hours_admin)     || 0) +
      (parseFloat(job.hours_machining)  || 0) +
      (parseFloat(job.hours_assembly)   || 0) +
      (parseFloat(job.hours_delivery)   || 0) +
      (parseFloat(job.hours_install)    || 0);

    const subject = `New Job Created — #${job.job_number} | ${job.client_name}`;

    const html = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222; max-width: 520px;">
        <h2 style="margin-bottom: 4px;">New Job Created</h2>
        <p style="color: #555; margin-top: 0;">Space Tech Design Job Tracker</p>
        <table style="border-collapse: collapse; width: 100%; margin-top: 16px;">
          <tr style="background: #f4f4f4;">
            <td style="padding: 8px 12px; font-weight: bold; width: 40%;">Job #</td>
            <td style="padding: 8px 12px;">${job.job_number}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; font-weight: bold;">Company</td>
            <td style="padding: 8px 12px;">${job.client_name || '—'}</td>
          </tr>
          <tr style="background: #f4f4f4;">
            <td style="padding: 8px 12px; font-weight: bold;">Project</td>
            <td style="padding: 8px 12px;">${job.project || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; font-weight: bold;">Due Date</td>
            <td style="padding: 8px 12px;">${formatDate(job.wip_due)}</td>
          </tr>
          <tr style="background: #f4f4f4;">
            <td style="padding: 8px 12px; font-weight: bold; vertical-align: top;">Hours</td>
            <td style="padding: 8px 12px; line-height: 1.8;">
              Admin: ${formatHours(job.hours_admin)}<br>
              Machining: ${formatHours(job.hours_machining)}<br>
              Assembly: ${formatHours(job.hours_assembly)}<br>
              Delivery: ${formatHours(job.hours_delivery)}<br>
              Install: ${formatHours(job.hours_install)}<br>
              <strong>Total: ${formatHours(totalHours)}</strong>
            </td>
          </tr>
        </table>
      </div>
    `;

    const csvContent = buildJobCsv(job, contact);
    const csvFilename = `job-${job.job_number}.csv`;

    await resend.emails.send({
      from: 'jobs@mcdonoughdesign.com.au',
      to: toEmail,
      subject,
      html,
      attachments: [
        {
          filename: csvFilename,
          content: Buffer.from(csvContent),
        },
      ],
    });

    console.log(`[emailService] Job notification sent to ${toEmail} for job #${job.job_number} (attachment: ${csvFilename})`);
  } catch (err) {
    console.error('[emailService] Failed to send job notification:', err.message);
  }
}

module.exports = { sendJobNotification };
