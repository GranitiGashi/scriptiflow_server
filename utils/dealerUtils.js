const supabase = require('../config/supabaseClient');
const axios = require('axios');

async function getDealerLogoUrl({ userId, username, password }) {
  // First try cached
  const { data: asset } = await supabase
    .from('dealer_assets')
    .select('dealer_logo_url, logo_last_checked_at')
    .eq('user_id', userId)
    .maybeSingle();

  const ageMs = asset?.logo_last_checked_at ? (Date.now() - new Date(asset.logo_last_checked_at).getTime()) : Infinity;
  if (asset?.dealer_logo_url && ageMs < 7 * 24 * 60 * 60 * 1000) {
    return asset.dealer_logo_url;
  }

  // Attempt to fetch from mobile.de profile (placeholder: requires real endpoint)
  try {
    const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    // NOTE: Replace this with the correct mobile.de API for dealer profile/logo
    const res = await axios.get('https://services.mobile.de/search-api/profile', {
      headers: { Authorization: auth, Accept: 'application/vnd.de.mobile.api+json' },
      validateStatus: () => true,
    });
    let url = null;
    if (res.status >= 200 && res.status < 300) {
      url = res.data?.dealer?.logoUrl || res.data?.logoUrl || null;
    }
    await supabase
      .from('dealer_assets')
      .upsert({ user_id: userId, dealer_logo_url: url, logo_last_checked_at: new Date().toISOString() }, { onConflict: ['user_id'] });
    return url;
  } catch (_) {
    return asset?.dealer_logo_url || null;
  }
}

module.exports = { getDealerLogoUrl };

