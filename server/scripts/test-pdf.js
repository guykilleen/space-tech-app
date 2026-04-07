/**
 * Generates a test PDF for a QB quote and saves it to disk.
 *
 * Usage:
 *   node server/scripts/test-pdf.js <quote-id> [output-path]
 *
 * Example:
 *   node server/scripts/test-pdf.js abc123 ./test-output.pdf
 *
 * The script calls the same logic as the API endpoint — no HTTP server needed.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fs         = require('fs');
const pool       = require('../config/db');
const puppeteer  = require('puppeteer');

// ── Inline the same fetchFull + getPdf logic ─────────────────────────────

async function fetchFull(id) {
  const { rows: [header] } = await pool.query(
    `SELECT h.*,
            c.name    AS contact_name,
            c.email   AS contact_email,
            c.company AS contact_company,
            c.phone   AS contact_phone
       FROM qb_quote_headers h
  LEFT JOIN qb_contacts c ON c.id = h.client_id
      WHERE h.id = $1`,
    [id]
  );
  if (!header) return null;

  const { rows: units } = await pool.query(
    `SELECT * FROM qb_quote_units WHERE quote_id = $1 ORDER BY sort_order, unit_number`,
    [id]
  );

  for (const u of units) {
    const { rows: lines } = await pool.query(
      `SELECT * FROM qb_quote_unit_lines WHERE unit_id = $1 ORDER BY sort_order, created_at`,
      [u.id]
    );
    u.lines = lines;
  }

  header.units = units;
  return header;
}

async function main() {
  const quoteId  = process.argv[2];
  const outPath  = process.argv[3] || './quote-test-output.pdf';

  if (!quoteId) {
    console.error('Usage: node server/scripts/test-pdf.js <quote-id> [output-path]');
    console.error('\nTo find a quote ID, run:');
    console.error('  psql $DATABASE_URL -c "SELECT id, quote_number, project FROM qb_quote_headers LIMIT 10;"');
    process.exit(1);
  }

  console.log(`Fetching quote ${quoteId}...`);
  const quote = await fetchFull(quoteId);
  if (!quote) {
    console.error('Quote not found.');
    process.exit(1);
  }
  console.log(`Found: ${quote.quote_number} — ${quote.project || '(no project)'}`);

  // ── Calculations ────────────────────────────────────────
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

  // ── Formatters ───────────────────────────────────────────
  const fmt  = v => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v);
  const fmtD = v => v ? new Date(v).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const esc  = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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

  const clientLines = [
    quote.contact_name    ? `<strong>${esc(quote.contact_name)}</strong>` : null,
    quote.contact_company ? esc(quote.contact_company)                    : null,
    quote.contact_email   ? esc(quote.contact_email)                      : null,
    quote.contact_phone   ? esc(quote.contact_phone)                      : null,
  ].filter(Boolean);
  const clientBlock = clientLines.length
    ? clientLines.join('<br>')
    : '<em style="color:#aaa">No client details</em>';

  const preparedByRow = quote.prepared_by
    ? `<tr><td>Prepared by</td><td>${esc(quote.prepared_by)}</td></tr>` : '';
  const projectRow = quote.project
    ? `<tr><td>Project</td><td>${esc(quote.project)}</td></tr>` : '';

  const statusLabels = { draft: 'Draft', pending: 'Pending', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' };
  const statusBadge = statusLabels[quote.status] || esc(quote.status);
  const notesBlock  = quote.notes
    ? `<div class="notes-section"><strong>Notes</strong>${esc(quote.notes)}</div>` : '';

  const templatePath = path.join(__dirname, '../templates/quote-pdf.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  html = html
    .replace(/\{\{QUOTE_NUMBER\}\}/g,   esc(quote.quote_number))
    .replace(/\{\{DATE\}\}/g,            fmtD(quote.date))
    .replace(/\{\{CLIENT_BLOCK\}\}/g,    clientBlock)
    .replace(/\{\{PREPARED_BY_ROW\}\}/g, preparedByRow)
    .replace(/\{\{PROJECT_ROW\}\}/g,     projectRow)
    .replace(/\{\{STATUS_BADGE\}\}/g,    statusBadge)
    .replace(/\{\{UNIT_ROWS\}\}/g,       unitRowsHtml)
    .replace(/\{\{SUBTOTAL\}\}/g,        fmt(subtotal))
    .replace(/\{\{GST\}\}/g,             fmt(gst))
    .replace(/\{\{TOTAL_INCL_GST\}\}/g,  fmt(total_incl_gst))
    .replace(/\{\{NOTES_BLOCK\}\}/g,     notesBlock);

  console.log('Launching Puppeteer...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', bottom: '18mm', left: '0mm', right: '0mm' },
  });
  await browser.close();

  const absOut = path.resolve(outPath);
  fs.writeFileSync(absOut, pdf);
  console.log(`\nPDF saved to: ${absOut}`);
  console.log(`Size: ${(pdf.length / 1024).toFixed(1)} KB`);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
