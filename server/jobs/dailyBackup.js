const cron = require('node-cron');
const { runBackup } = require('../services/backupService');

// 2:00 am AEST = 16:00 UTC (Brisbane is UTC+10, no DST)
cron.schedule('0 16 * * *', async () => {
  console.log('[dailyBackup] Triggering scheduled backup...');
  await runBackup();
});

console.log('[dailyBackup] Scheduled: daily 16:00 UTC (02:00 AEST)');
