const axios = require('axios');
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt, decrypt } = require('../utils/crypto');

const AS24_BASE = 'https://listing-creation.api.autoscout24.com';

// In-memory guard to avoid concurrent syncs per user
const inFlightAS24SyncByUser = new Map();

async function getBasicAuthHeaderForUser(userId) {
  const { data: cred } = await supabase
    .from('mobile_de_credentials')
    .select('username, encrypted_password')
    .eq('user_id', userId)
    .eq('provider', 'autoscout24')
    .maybeSingle();
  if (!cred) throw new Error('No AutoScout24 credentials');
  const [iv, enc] = String(cred.encrypted_password || '').split(':');
  if (!iv || !enc) throw new Error('Invalid AutoScout24 password');
  const password = decrypt(enc, iv);
  const auth = 'Basic ' + Buffer.from(`${cred.username}:${password}`).toString('base64');
  return auth;
}

async function fetchAS24Listings(userId) {
  const auth = await getBasicAuthHeaderForUser(userId);
  const resp = await axios.get(`${AS24_BASE}/listings`, {
    headers: {
      Authorization: auth,
      Accept: 'application/json',
    },
    validateStatus: () => true,
  });
  if (resp.status < 200 || resp.status >= 300) {
    const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    throw new Error(`AutoScout24 listings failed: ${resp.status} ${body}`);
  }
  // Expect a list/array; fallback to nested shapes
  const items = Array.isArray(resp.data)
    ? resp.data
    : (Array.isArray(resp.data?.items) ? resp.data.items : []);
  return items;
}

async function performAS24SyncForUser(userId) {
  const { data: cred } = await supabase
    .from('mobile_de_credentials')
    .select('user_id')
    .eq('user_id', userId)
    .eq('provider', 'autoscout24')
    .maybeSingle();
  if (!cred) return { synced: false, new_listings: 0, total_seen: 0, reason: 'no_credentials' };

  const listings = await fetchAS24Listings(userId);
  let newCount = 0;

  for (const ad of listings) {
    const as24Id = String(ad.id || ad.listingId || ad.uuid || '').trim();
    if (!as24Id) continue;

    const { data: existing } = await supabase
      .from('mobile_de_listings')
      .select('listing_id')
      .eq('user_id', userId)
      .eq('provider', 'autoscout24')
      .eq('listing_id', as24Id)
      .maybeSingle();
    if (existing) {
      await supabase
        .from('mobile_de_listings')
        .update({ last_seen: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('provider', 'autoscout24')
        .eq('listing_id', as24Id);
      continue;
    }

    // Images try best-effort extraction
    let imagesArr = [];
    try {
      if (Array.isArray(ad.images)) {
        imagesArr = ad.images
          .map(i => i?.url || i?.href || i?.source || null)
          .filter(Boolean)
          .slice(0, 10);
      } else if (Array.isArray(ad.media)) {
        imagesArr = ad.media
          .map(i => i?.url || i?.href || i?.source || null)
          .filter(Boolean)
          .slice(0, 10);
      }
    } catch (_) {}
    const imagePrimary = imagesArr.length ? imagesArr[0] : null;

    await supabase
      .from('mobile_de_listings')
      .insert({
        user_id: userId,
        provider: 'autoscout24',
        listing_id: as24Id,
        details: ad || null,
        image_xxxl_url: imagePrimary,
        images: imagesArr.length ? imagesArr : null,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });

    try {
      const originalImages = imagesArr.length ? imagesArr : (imagePrimary ? [imagePrimary] : []);
      if (originalImages.length) {
        const jobs = originalImages.slice(0, 10).map((imgUrl, idx) => ({
          user_id: userId,
          listing_id: as24Id,
          original_url: imgUrl,
          provider: 'clipdrop',
          options: { background: { type: 'white' }, overlayLogo: idx === 0, outputFormat: 'png' },
        }));
        await supabase.from('image_processing_jobs').insert(jobs);
      }
    } catch (_) {}

    try {
      const make = (ad?.make || ad?.vehicle?.make || '').toString();
      const model = (ad?.model || ad?.vehicle?.model || '').toString();
      const caption = `${make} ${model}`.trim();
      const detailUrl = ad?.detailPageUrl || ad?.publicUrl || null;
      for (const platform of ['facebook', 'instagram']) {
        await supabase
          .from('social_post_jobs')
          .insert({ user_id: userId, platform, payload: { images: imagesArr, caption, detail_url: detailUrl, make, model, provider: 'autoscout24', listing_id: as24Id } });
      }
    } catch (_) {}
    newCount += 1;
  }

  await supabase
    .from('mobile_de_credentials')
    .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'autoscout24');

  return { synced: true, new_listings: newCount, total_seen: listings.length };
}

async function maybeStartBackgroundSync(userId) {
  if (inFlightAS24SyncByUser.has(userId)) return;
  try {
    const { data: cred } = await supabase
      .from('mobile_de_credentials')
      .select('last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'autoscout24')
      .maybeSingle();

    const last = cred?.last_sync_at ? new Date(cred.last_sync_at).getTime() : 0;
    const now = Date.now();
    const minIntervalMs = 60 * 1000;
    if (now - last < minIntervalMs) return;

    inFlightAS24SyncByUser.set(userId, true);
    performAS24SyncForUser(userId)
      .catch((err) => {
        console.error('Background sync AutoScout24 failed:', err);
      })
      .finally(() => {
        inFlightAS24SyncByUser.delete(userId);
      });
  } catch (_) {}
}

exports.connectAutoScout24 = async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { iv, encryptedData } = encrypt(password);
    const upsertRes = await supabase
      .from('mobile_de_credentials')
      .upsert({ user_id: userId, provider: 'autoscout24', username, encrypted_password: `${iv}:${encryptedData}`, updated_at: new Date().toISOString() }, { onConflict: ['user_id', 'provider'] });
    if (upsertRes.error) {
      return res.status(500).json({ error: 'Failed to save credentials', details: upsertRes.error.message });
    }
    return res.json({ message: 'AutoScout24 credentials saved successfully' });
  } catch (err) {
    console.error('connectAutoScout24 error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.getAutoScout24Credentials = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { data, error } = await supabase
      .from('mobile_de_credentials')
      .select('username, encrypted_password')
      .eq('user_id', userId)
      .eq('provider', 'autoscout24')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'No credentials found' });
    const [iv, enc] = String(data.encrypted_password || '').split(':');
    const password = iv && enc ? decrypt(enc, iv) : null;
    return res.json({ username: data.username, password });
  } catch (err) {
    console.error('getAutoScout24Credentials error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.editAutoScout24Credentials = async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { iv, encryptedData } = encrypt(password);
    const { error } = await supabase
      .from('mobile_de_credentials')
      .update({ username, encrypted_password: `${iv}:${encryptedData}`, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', 'autoscout24');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ message: 'AutoScout24 credentials updated successfully' });
  } catch (err) {
    console.error('editAutoScout24Credentials error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.deleteAutoScout24Credentials = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { error } = await supabase
      .from('mobile_de_credentials')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'autoscout24');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ message: 'AutoScout24 credentials deleted successfully' });
  } catch (err) {
    console.error('deleteAutoScout24Credentials error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.getAS24ListingsRemote = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const items = await fetchAS24Listings(userId);
    return res.json(items);
  } catch (err) {
    console.error('getAS24ListingsRemote error:', err);
    return res.status(500).json({ error: 'Failed to fetch AutoScout24 listings', details: err.message });
  }
};

exports.getAS24Status = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { data: cred } = await supabase
      .from('mobile_de_credentials')
      .select('last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'autoscout24')
      .maybeSingle();

    const { data: countRows } = await supabase
      .from('mobile_de_listings')
      .select('listing_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('provider', 'autoscout24');
    const total_listings = (countRows && Array.isArray(countRows)) ? countRows.length : (countRows?.length || null);

    const { data: latest } = await supabase
      .from('mobile_de_listings')
      .select('first_seen')
      .eq('user_id', userId)
      .eq('provider', 'autoscout24')
      .order('first_seen', { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.json({
      last_sync_at: cred?.last_sync_at || null,
      latest_first_seen: latest?.first_seen || null,
      total_listings: total_listings,
    });
  } catch (err) {
    console.error('getAS24Status error:', err);
    return res.status(500).json({ error: 'Failed to get status', details: err.message });
  }
};

exports.getAS24Listings = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

    // Trigger background refresh
    maybeStartBackgroundSync(userId);

    const { data, error } = await supabase
      .from('mobile_de_listings')
      .select('listing_id, first_seen, last_seen, details, image_xxxl_url, images')
      .eq('user_id', userId)
      .eq('provider', 'autoscout24')
      .order('first_seen', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    console.error('getAS24Listings error:', err);
    return res.status(500).json({ error: 'Failed to get listings', details: err.message });
  }
};

exports.seedAS24Dummy = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { as24_listing_id, images = [], make = 'AUDI', model = 'A4', detail_url, caption } = req.body || {};
    const listingId = String(as24_listing_id || `as24-dummy-${Date.now()}`);
    const imagesArr = Array.isArray(images) ? images.filter(Boolean).slice(0, 10) : [];
    const image_primary_url = imagesArr[0] || null;

    await supabase
      .from('autoscout24_listings')
      .upsert({
        user_id: userId,
        as24_listing_id: listingId,
        details: { make, model, detailPageUrl: detail_url || null },
        image_primary_url,
        images: imagesArr.length ? imagesArr : null,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });

    const baseCaption = `${make} ${model}`.trim();
    const payload = { images: imagesArr, caption: caption || baseCaption, detail_url: detail_url || null, make, model };
    for (const platform of ['facebook', 'instagram']) {
      await supabase
        .from('social_post_jobs')
        .insert({ user_id: userId, platform, autoscout24_listing_id: listingId, payload });
    }

    return res.json({ seeded: true, as24_listing_id: listingId, images: imagesArr.length });
  } catch (err) {
    console.error('seedAS24Dummy error:', err);
    return res.status(500).json({ error: 'Failed to seed dummy listing', details: err.message });
  }
};

exports.syncAS24 = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const result = await performAS24SyncForUser(userId);
    if (result.reason === 'no_credentials') {
      return res.status(404).json({ error: 'No AutoScout24 credentials found' });
    }
    return res.json(result);
  } catch (err) {
    console.error('syncAS24 error:', err);
    return res.status(500).json({ error: 'Failed to sync AutoScout24', details: err.message });
  }
};


