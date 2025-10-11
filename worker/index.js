const { runOnce: runSocial } = require('./socialPoster');
const { runOnce: runImages } = require('./imageProcessor');
const { performMobileDeSyncForUser } = require('../controllers/mobiledeController');
const supabase = require('../config/supabaseClient');

async function syncAllUsers() {
  try {
    const { data: rows } = await supabase
      .from('mobile_de_credentials')
      .select('user_id')
      .is('deleted_at', null);
    const userIds = Array.from(new Set((rows || []).map(r => r.user_id))).filter(Boolean);
    for (const uid of userIds) {
      try { await performMobileDeSyncForUser(uid); } catch (_) {}
    }
  } catch (_) {}
}

async function loop() {
  try {
    await syncAllUsers();
    await Promise.all([
      runImages(parseInt(process.env.IMAGE_WORKER_BATCH || '3', 10)),
      runSocial(5),
    ]);
  } catch (e) {}
  const delay = parseInt(process.env.IMAGE_WORKER_INTERVAL_MS || '4000', 10);
  setTimeout(loop, delay);
}

loop();
