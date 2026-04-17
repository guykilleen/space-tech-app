const ExcelJS = require('exceljs');
const pool    = require('../config/db');

// ─── helpers ────────────────────────────────────────────────────────────────

function cellVal(cell) {
  if (!cell) return '';
  if (cell.type === ExcelJS.ValueType.Date) return cell.value;
  if (cell.formula) return cell.result ?? '';
  return cell.value ?? '';
}

function toStr(v) { return String(v ?? '').trim(); }

function toFloat(v) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function excelToISO(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const iso = v.toISOString().split('T')[0];
    return iso === '1899-12-30' ? null : iso; // Excel epoch artifact
  }
  const s = String(v).trim();
  if (!s || s === '0') return null;
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
  // DD/MM/YYYY or similar
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().split('T')[0];
}

// Normalise job numbers: strip leading zeros, handle variant suffixes
// e.g. "0048" → "48", "48b" → "48_1", "48v1" → "48_1"
function normaliseJob(raw) {
  const s = toStr(raw);
  const m = s.match(/^0*(\d+)[\s_\-]?([vVbBcC]?)(\d*)$/);
  if (m) {
    const base = m[1];
    const sfx  = (m[2] || '').toLowerCase();
    const num  = m[3];
    if (sfx && num) return base + '_' + num;
    if (sfx === 'b') return base + '_1';
    if (sfx === 'c') return base + '_2';
    return base;
  }
  return s;
}

// Row → plain array of cell values (1-indexed → 0-indexed)
function rowToArr(row, len = 25) {
  const arr = new Array(len).fill('');
  row.eachCell({ includeEmpty: true }, (cell, colNum) => {
    if (colNum <= len) arr[colNum - 1] = cellVal(cell);
  });
  return arr;
}

// ─── main handler ────────────────────────────────────────────────────────────

async function importXlsx(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const result = { quotesAdded: 0, jobsAdded: 0, skipped: 0, errors: [] };

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);

    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');

      // ── 1. QUOTES — "Quote No." sheet ─────────────────────────────────────
      // Cols (0-based): 0=Quote No, 1=Prepared By, 2=Date, 3=Project,
      //   4=Client, 5=Filter, 6=Value, 7=Won(Y/N), 8=Order No, 9=Order Date
      const qws = wb.getWorksheet('Quote No.');
      if (qws) {
        let first = true;
        for (const row of qws.getRows(1, qws.rowCount) || []) {
          if (first) { first = false; continue; } // skip header
          const r = rowToArr(row, 12);
          const num = toStr(r[0]);
          if (!num) continue;

          const { rows: ex } = await dbClient.query(
            'SELECT id FROM quotes WHERE quote_number = $1', [num]
          );
          if (ex.length) { result.skipped++; continue; }

          const clientName = toStr(r[4]);
          if (!clientName) continue;

          const won = toStr(r[7]).toLowerCase();
          const status = won === 'y' || won === 'yes' ? 'accepted'
                       : won === 'n' || won === 'no'  ? 'sent'
                       : 'draft';

          await dbClient.query(
            `INSERT INTO quotes
               (quote_number, initials, date, project, client_name, value,
                status, accept_details, accept_date, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              num,
              toStr(r[1]) || null,
              excelToISO(r[2]),
              toStr(r[3]) || null,
              clientName,
              toFloat(r[6]),
              status,
              toStr(r[8]) || null,
              excelToISO(r[9]),
              req.user.id,
            ]
          );
          result.quotesAdded++;
        }
      }

      // ── 2. HOURS LOOKUP — "WIP Yearly Calender" sheet ─────────────────────
      // Data from row 8 (1-indexed), row 7 is header
      // Cols (0-based): 1=Job, 5=Admin/Draw, 8=FlatBed, 9=Cut&Edge (both→machining)
      //   10=Assembly, 12=Deliver, 13=Installation, 17=Due onsite
      const wipHours = {};
      const wws = wb.getWorksheet('WIP Yearly Calender');
      if (wws) {
        const startRow = 8;
        for (const row of wws.getRows(startRow, Math.max(0, wws.rowCount - startRow + 1)) || []) {
          const r   = rowToArr(row, 20);
          const raw = toStr(r[1]);
          if (!raw) continue;
          const j = normaliseJob(raw);
          wipHours[j] = {
            hours_admin:     toFloat(r[5]),
            hours_machining: toFloat(r[8]) + toFloat(r[9]),
            hours_assembly:  toFloat(r[10]),
            hours_delivery:  toFloat(r[12]),
            hours_install:   toFloat(r[13]),
            wip_due:         excelToISO(r[17]),
          };
          // Also index by raw value in case normalise doesn't match
          if (raw !== j) wipHours[raw] = wipHours[j];
        }
      }

      // ── 3. JOBS — "Job No." sheet ──────────────────────────────────────────
      // Cols (0-based): 0=Job No, 1=Quote No, 2=PM, 3=Project, 4=Client
      const jws = wb.getWorksheet('Job No.');
      if (jws) {
        let first = true;
        for (const row of jws.getRows(1, jws.rowCount) || []) {
          if (first) { first = false; continue; }
          const r      = rowToArr(row, 8);
          const jobRaw = toStr(r[0]);
          if (!jobRaw) continue;

          // Skip known Excel auto-fill artifact range
          const jobInt = parseInt(jobRaw, 10);
          if (jobInt >= 11108 && jobInt <= 11171) continue;

          const { rows: ex } = await dbClient.query(
            'SELECT id FROM jobs WHERE job_number = $1', [jobRaw]
          );
          if (ex.length) { result.skipped++; continue; }

          const clientName = toStr(r[4]);
          if (!clientName) continue;

          const jobNorm = normaliseJob(jobRaw);
          const hrs     = wipHours[jobNorm] || wipHours[jobRaw] || {};

          const qNum = toStr(r[1]) || null;
          let quoteId = null;
          if (qNum) {
            const { rows: qr } = await dbClient.query(
              'SELECT id FROM quotes WHERE quote_number = $1', [qNum]
            );
            if (qr[0]) quoteId = qr[0].id;
          }

          await dbClient.query(
            `INSERT INTO jobs
               (job_number, quote_id, quote_number, client_name, project,
                hours_admin, hours_machining, hours_assembly, hours_delivery, hours_install,
                wip_due, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              jobRaw,
              quoteId,
              qNum,
              clientName,
              toStr(r[3]) || null,
              hrs.hours_admin     || 0,
              hrs.hours_machining || 0,
              hrs.hours_assembly  || 0,
              hrs.hours_delivery  || 0,
              hrs.hours_install   || 0,
              hrs.wip_due         || null,
              req.user.id,
            ]
          );
          result.jobsAdded++;
        }
      }

      await dbClient.query('COMMIT');
      res.json(result);

    } catch (err) {
      await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      dbClient.release();
    }

  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
}

// ─── Clear all data (admin only) ─────────────────────────────────────────────
async function clearAll(req, res) {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('DELETE FROM jobs');
    await dbClient.query('DELETE FROM quotes');
    await dbClient.query('COMMIT');
    res.json({ message: 'All quotes and jobs deleted' });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Clear failed' });
  } finally {
    dbClient.release();
  }
}

module.exports = { importXlsx, clearAll };
