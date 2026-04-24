const { spawn } = require('child_process');
const zlib = require('zlib');
const { Resend } = require('resend');

const MAX_BYTES = 40 * 1024 * 1024; // 40 MB Resend attachment limit

function dumpAndCompress(dbUrl) {
  return new Promise((resolve, reject) => {
    const pg = spawn('pg_dump', ['--dbname', dbUrl, '--no-password', '--format=plain']);
    const gz = zlib.createGzip();
    const chunks = [];
    let gzipEnded = false;
    let pgCode = null;
    let fatal = null;

    const tryFinalize = () => {
      if (!gzipEnded || pgCode === null) return;
      if (fatal) return reject(fatal);
      if (pgCode !== 0) return reject(new Error(`pg_dump exited with code ${pgCode}`));
      resolve(Buffer.concat(chunks));
    };

    pg.stdout.pipe(gz);

    gz.on('data', chunk => chunks.push(chunk));
    gz.on('end', () => { gzipEnded = true; tryFinalize(); });
    gz.on('error', err => { fatal = err; gzipEnded = true; tryFinalize(); });

    pg.stderr.on('data', data => {
      const msg = data.toString().trim();
      if (msg) console.warn('[backupService] pg_dump:', msg);
    });

    pg.on('error', err => {
      fatal = err.code === 'ENOENT'
        ? new Error('pg_dump not found — PostgreSQL client tools must be in PATH')
        : err;
      pgCode = -1;
      tryFinalize();
    });

    pg.on('close', code => { pgCode = code; tryFinalize(); });
  });
}

async function runBackup() {
  const dbUrl     = process.env.DATABASE_URL;
  const apiKey    = process.env.RESEND_API_KEY;
  const toEmail   = process.env.BACKUP_EMAIL;

  if (!dbUrl)   { console.error('[backupService] DATABASE_URL not set — aborting'); return; }
  if (!apiKey)  { console.error('[backupService] RESEND_API_KEY not set — aborting'); return; }
  if (!toEmail) { console.error('[backupService] BACKUP_EMAIL not set — aborting'); return; }

  const today    = new Date().toISOString().slice(0, 10);
  const filename = `spacetech-backup-${today}.sql.gz`;

  console.log(`[backupService] Running pg_dump → ${filename}`);

  try {
    const compressed = await dumpAndCompress(dbUrl);
    const kb = (compressed.length / 1024).toFixed(0);

    if (compressed.length > MAX_BYTES) {
      console.warn(`[backupService] Backup is ${(compressed.length / 1024 / 1024).toFixed(1)} MB — exceeds 40 MB Resend limit, skipping email`);
      return;
    }

    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: 'jobs@mcdonoughdesign.com.au',
      to: toEmail,
      subject: `Space Tech Design DB Backup — ${today}`,
      html: `<p style="font-family:Arial,sans-serif;font-size:14px;">Daily database backup attached.</p>
             <p style="font-family:Arial,sans-serif;font-size:14px;"><strong>File:</strong> ${filename}<br><strong>Size:</strong> ${kb} KB</p>`,
      attachments: [{ filename, content: compressed }],
    });

    console.log(`[backupService] Backup sent to ${toEmail} — ${filename} (${kb} KB)`);
  } catch (err) {
    console.error('[backupService] Backup failed:', err.message);
  }
}

module.exports = { runBackup };
