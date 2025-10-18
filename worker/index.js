require('dotenv').config();
const { runOnce: runSocial } = require('./socialPoster');
const { runOnce: runImages } = require('./imageProcessor');
const { performMobileDeSyncForUser } = require('../controllers/mobiledeController');
const supabaseAdmin = require('../config/supabaseAdmin');

const inFlightSyncUserIds = new Set();

async function syncAllUsers() {
  try {
    const { data: rows } = await supabaseAdmin
      .from('mobile_de_credentials')
      .select('user_id, last_sync_at')
      .eq('provider', 'mobile_de')
      .is('deleted_at', null);
    const msBetweenSyncs = parseInt(process.env.MOBILEDE_SYNC_INTERVAL_MS || '60000', 10);
    const now = Date.now();
    const userIds = Array.from(new Set((rows || []).map(r => r.user_id))).filter(Boolean);
    for (const uid of userIds) {
      const row = (rows || []).find(r => r.user_id === uid);
      const last = row?.last_sync_at ? new Date(row.last_sync_at).getTime() : 0;
      const due = !last || (now - last >= msBetweenSyncs);
      if (!due) continue;
      if (inFlightSyncUserIds.has(uid)) continue;
      inFlightSyncUserIds.add(uid);
      performMobileDeSyncForUser(uid)
        .catch(() => {})
        .finally(() => { inFlightSyncUserIds.delete(uid); });
    }
  } catch (_) {}
}

async function loop() {
  try {
    await syncAllUsers();
    await Promise.all([
      runImages(parseInt(process.env.IMAGE_WORKER_BATCH || '3', 10)),
      runSocial(parseInt(process.env.SOCIAL_WORKER_BATCH || '5', 10)),
    ]);
  } catch (e) {}
  const delay = parseInt(process.env.WORKER_LOOP_INTERVAL_MS || process.env.IMAGE_WORKER_INTERVAL_MS || '5000', 10);
  setTimeout(loop, delay);
}

loop();
