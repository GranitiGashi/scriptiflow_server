const supabase = require('../config/supabaseClient');
const { fetchEmailsForUser } = require('../controllers/emailController');

async function runOnce(limit = 20) {
  // Get users with connected email providers
  const { data: creds } = await supabase
    .from('email_credentials')
    .select('user_id')
    .limit(500);
  const uniqueUsers = Array.from(new Set((creds || []).map((c) => c.user_id))).slice(0, limit);
  let total = 0;
  for (const userId of uniqueUsers) {
    try {
      const res = await fetchEmailsForUser(userId);
      total += res.processed || 0;
    } catch (_) {}
  }
  return { users: uniqueUsers.length, leadsProcessed: total };
}

module.exports = { runOnce };


