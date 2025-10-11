// controllers/mobiledeController.js
const supabase = require('../config/supabaseClient');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt, decrypt } = require('../utils/crypto');
const axios = require('axios');
const supabaseAdmin = require('../config/supabaseAdmin');

async function fetchMobileDeListings(username, password, params = {}) {
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const response = await axios.get('https://services.mobile.de/search-api/search', {
    headers: { Authorization: auth, Accept: 'application/vnd.de.mobile.api+json' },
    params,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    throw new Error(`mobile.de search failed: ${response.status} ${body}`);
  }
  return response.data;
}

async function fetchMobileDeDetails(username, password, mobileAdId) {
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const response = await axios.get(`https://services.mobile.de/search-api/search/${encodeURIComponent(mobileAdId)}`, {
    headers: { Authorization: auth, Accept: 'application/vnd.de.mobile.api+json' },
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    throw new Error(`mobile.de details failed: ${response.status} ${body}`);
  }
  return response.data;
}

// In-memory guard to avoid concurrent syncs per user
const inFlightMobileDeSyncByUser = new Map();

// Perform a full sync for a specific user (used by explicit route and background refresh)
async function performMobileDeSyncForUser(userId) {
  const credRes = await supabase
    .from('mobile_de_credentials')
    .select('username, encrypted_password')
    .eq('user_id', userId)
    .eq('provider', 'mobile_de')
    .is('deleted_at', null)
    .maybeSingle();
  if (credRes.error || !credRes.data) {
    return { synced: false, new_listings: 0, total_seen: 0, reason: 'no_credentials' };
  }

  const [iv, encryptedPassword] = credRes.data.encrypted_password.split(':');
  const password = decrypt(encryptedPassword, iv);
  const username = credRes.data.username;

  // Fetch current listings across all pages (paginate)
  const pageSize = 100;
  let page = 1;
  let totalSeen = 0;
  let newCount = 0;

  // Iterate pages until fewer than pageSize results are returned
  // Sort by newest to prioritize recent changes
  while (true) {
    const searchData = await fetchMobileDeListings(username, password, {
      'page.number': page,
      'page.size': pageSize,
      'sort.field': 'modificationTime',
      'sort.order': 'DESCENDING',
    });
    const ads = Array.isArray(searchData?.['search-result']?.ads?.ad)
      ? searchData['search-result'].ads.ad
      : [];
    if (!ads.length) break;
    totalSeen += ads.length;

    for (const ad of ads) {
    const mobileAdId = String(ad.id || ad.mobileAdId || ad['mobile-ad-id'] || '').trim();
    if (!mobileAdId) continue;

    // Upsert only if new; if exists, update missing details
    const { data: existing } = await supabase
      .from('mobile_de_listings')
      .select('mobile_ad_id, details')
      .eq('user_id', userId)
      .eq('provider', 'mobile_de')
      .eq('mobile_ad_id', mobileAdId)
      .maybeSingle();
    if (existing) {
      // Update last_seen
      await supabase
        .from('mobile_de_listings')
        .update({ last_seen: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('provider', 'mobile_de')
        .eq('mobile_ad_id', mobileAdId);
      // If details missing or incomplete, update with best-effort info from ad
      try {
        const existingDetails = existing?.details || null;
        const existingMake = (existingDetails && (existingDetails.make || existingDetails?.vehicle?.make)) ? String(existingDetails.make || existingDetails?.vehicle?.make) : '';
        const existingModel = (existingDetails && (existingDetails.model || existingDetails?.vehicle?.model)) ? String(existingDetails.model || existingDetails?.vehicle?.model) : '';
        const merged = { ...(existingDetails || {}), make: existingMake || (ad.make || ad?.vehicle?.make || ''), model: existingModel || (ad.model || ad?.vehicle?.model || '') };
        if (!existingDetails || !existingMake || !existingModel) {
          await supabase
            .from('mobile_de_listings')
            .update({ details: merged })
            .eq('user_id', userId)
            .eq('provider', 'mobile_de')
            .eq('mobile_ad_id', mobileAdId);
        }
      } catch {}
      continue;
    }

    // Fetch full details for new ad
    let details = null;
    let image_xxxl_url = null;
    let imagesArr = [];
    try {
      details = await fetchMobileDeDetails(username, password, mobileAdId);
      const imgs = Array.isArray(details?.images) ? details.images : [];
      image_xxxl_url = imgs.find(i => i?.xxxl)?.xxxl || null;
      imagesArr = imgs.map(i => i?.xxxl || i?.xxl || i?.xl || i?.l || i?.m || i?.s).filter(Boolean);
    } catch (e) {
      // Continue even if details fail; we still store the ad id
    }

    // Merge minimal fields to ensure filters can be built even if details call fails
    const mergedDetails = {
      ...(details || {}),
      make: (details?.make || details?.vehicle?.make || ad.make || ad?.vehicle?.make || null),
      model: (details?.model || details?.vehicle?.model || ad.model || ad?.vehicle?.model || null),
      detailPageUrl: (details?.detailPageUrl || ad.detailPageUrl || null),
    };

    await supabase
      .from('mobile_de_listings')
      .insert({
        user_id: userId,
        provider: 'mobile_de',
        mobile_ad_id: mobileAdId,
        details: mergedDetails,
        image_xxxl_url,
        images: imagesArr.length ? imagesArr : null,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });

    // enqueue background image processing jobs for this listing
    try {
      const originalImages = imagesArr.length ? imagesArr : (image_xxxl_url ? [image_xxxl_url] : []);
      if (originalImages.length) {
        const jobs = originalImages.slice(0, 10).map((imgUrl, idx) => ({
          user_id: userId,
          listing_id: mobileAdId,
          original_url: imgUrl,
          provider: 'clipdrop',
          options: { background: { type: 'white' }, overlayLogo: idx === 0, outputFormat: 'png' },
        }));
        await supabase.from('image_processing_jobs').insert(jobs);
      }
    } catch (e) {
      // ignore queuing failures to not block sync
    }

    // Enqueue social posts (facebook + instagram if linked)
    const platforms = ['facebook', 'instagram'];
    for (const platform of platforms) {
      const caption = `${(details?.make || ad.make || '').toString()} ${(details?.model || ad.model || '').toString()}`.trim();
      await supabase
        .from('social_post_jobs')
        .insert({
          user_id: userId,
          platform,
          mobile_ad_id: mobileAdId,
          payload: {
            images: imagesArr.length ? imagesArr : (image_xxxl_url ? [image_xxxl_url] : []),
            caption,
            detail_url: details?.detailPageUrl || ad.detailPageUrl || null,
          },
        });
    }
      newCount += 1;
    }

    if (ads.length < pageSize) break;
    page += 1;
  }

  // Update last_sync_at
  await supabase
    .from('mobile_de_credentials')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'mobile_de');

  return { synced: true, new_listings: newCount, total_seen: totalSeen };
}

// Fire-and-forget background sync with minimal throttling
async function maybeStartBackgroundSync(userId) {
  if (inFlightMobileDeSyncByUser.has(userId)) return;
  try {
    const { data: cred } = await supabase
      .from('mobile_de_credentials')
      .select('last_sync_at')
      .eq('user_id', userId)
      .eq('provider', 'mobile_de')
      .maybeSingle();

    const last = cred?.last_sync_at ? new Date(cred.last_sync_at).getTime() : 0;
    const now = Date.now();
    const minIntervalMs = 60 * 1000; // throttle background sync to once per minute per user
    if (now - last < minIntervalMs) return;

    inFlightMobileDeSyncByUser.set(userId, true);
    performMobileDeSyncForUser(userId)
      .catch((err) => {
        console.error('Background syncMobileDe failed:', err);
      })
      .finally(() => {
        inFlightMobileDeSyncByUser.delete(userId);
      });
  } catch (err) {
    // Ignore background scheduling errors
  }
}

// controllers/mobiledeController.js
exports.connectMobile = async (req, res) => {
  const { username, password } = req.body;
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const sessionData = { user };

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;
    const { iv, encryptedData } = encrypt(password);

    console.log('Upserting credentials:', { user_id: userId, username, encrypted_password: `${iv}:${encryptedData}` });

    const upsertRes = await supabase
      .from('mobile_de_credentials')
      .upsert(
        { user_id: userId, provider: 'mobile_de', username, encrypted_password: `${iv}:${encryptedData}`, deleted_at: null },
        { onConflict: ['user_id', 'provider'] }
      );

    if (upsertRes.error) {
      console.error('Supabase upsert error:', upsertRes.error.message);
      return res.status(500).json({ error: 'Failed to save credentials', details: upsertRes.error.message });
    }

    res.json({ message: 'mobile.de credentials saved successfully' });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.getMobileCredentials = async (req, res) => {
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const sessionData = { user };

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;

    const selectRes = await supabase
      .from('mobile_de_credentials')
      .select('username, encrypted_password')
      .eq('user_id', userId)
      .eq('provider', 'mobile_de')
      .is('deleted_at', null)
      .maybeSingle();

    if (selectRes.error) {
      console.error('Supabase select error:', selectRes.error.message);
      return res.status(500).json({ error: 'Failed to retrieve credentials', details: selectRes.error.message });
    }

    const data = selectRes.data;
    if (!data) {
      return res.status(404).json({ error: 'No credentials found' });
    }

    // Decrypt password if needed, but for security, return masked or omit
    const [iv, encryptedPassword] = data.encrypted_password.split(':');
    const password = decrypt(encryptedPassword, iv);

    res.json({ username: data.username, password: password });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.editMobileCredentials = async (req, res) => {
  const { username, password } = req.body;
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const sessionData = { user };

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;
    const { iv, encryptedData } = encrypt(password);

    const updateRes = await supabase
      .from('mobile_de_credentials')
      .update({ username, encrypted_password: `${iv}:${encryptedData}`, deleted_at: null })
      .eq('user_id', userId)
      .eq('provider', 'mobile_de');

    if (updateRes.error) {
      console.error('Supabase update error:', updateRes.error.message);
      return res.status(500).json({ error: 'Failed to update credentials', details: updateRes.error.message });
    }

    res.json({ message: 'mobile.de credentials updated successfully' });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.deleteMobileCredentials = async (req, res) => {
  const accessToken = req.headers.authorization?.split('Bearer ')[1];
  const refreshToken = req.headers['x-refresh-token'];

  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const sessionData = { user };

    if (!sessionData.user) {
      console.error('No user in session');
      return res.status(401).json({ error: 'Unauthorized: No user found in session' });
    }

    const userId = sessionData.user.id;

    const { error: deleteError } = await supabase
      .from('mobile_de_credentials')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', 'mobile_de');

    if (deleteError) {
      console.error('Supabase delete error:', deleteError.message);
      return res.status(500).json({ error: 'Failed to delete credentials', details: deleteError.message });
    }

    res.json({ message: 'mobile.de credentials deleted successfully' });
  } catch (err) {
    console.error('Server error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};

exports.getUserCars = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const credRes = await supabase
      .from('mobile_de_credentials')
      .select('username, encrypted_password')
      .eq('user_id', userId)
      .single();

    if (credRes.error || !credRes.data) {
      return res.status(404).json({ error: 'No credentials found' });
    }

    const [iv, encryptedPassword] = credRes.data.encrypted_password.split(':');
    const password = decrypt(encryptedPassword, iv);
    const auth = 'Basic ' + Buffer.from(`${credRes.data.username}:${password}`).toString('base64');

    // Build query params for pagination, sorting and search
    const pageNumber = Math.max(1, parseInt(req.query.page || req.query['page.number'] || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.size || req.query['page.size'] || '20', 10) || 20));
    const sortField = (req.query.sortField || req.query['sort.field'] || 'modificationTime').toString();
    const sortOrder = (req.query.sortOrder || req.query['sort.order'] || 'DESCENDING').toString();

    // Accept classification directly or build it from make/model
    const directClassification = typeof req.query.classification === 'string' ? req.query.classification : null;
    const vehicleClass = (req.query.vehicleClass || 'Car').toString();
    const make = typeof req.query.make === 'string' ? req.query.make : undefined;
    const model = typeof req.query.model === 'string' ? req.query.model : undefined;
    const modelGroup = typeof req.query.modelGroup === 'string' ? req.query.modelGroup : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : (typeof req.query.search === 'string' ? req.query.search : undefined);

    let classification = directClassification || null;
    if (!classification && make) {
      // Construct classification path for cars; encoding is handled by axios
      const base = `refdata/classes/${vehicleClass}/makes/${make.toUpperCase()}`;
      if (model) classification = `${base}/models/${model.toUpperCase()}`;
      else if (modelGroup) classification = `${base}/modelgroups/${modelGroup}`;
      else classification = base;
    }

    const params = {
      'page.number': pageNumber,
      'page.size': pageSize,
      'sort.field': sortField,
      'sort.order': sortOrder,
    };
    if (classification) Object.assign(params, { classification });
    if (q) Object.assign(params, { modelDescription: q });

    const response = await axios.get('https://services.mobile.de/search-api/search', {
      headers: { Authorization: auth, Accept: 'application/vnd.de.mobile.api+json' },
      params,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({ error: 'mobile.de request failed', status: response.status, body: response.data });
    }
    return res.json(response.data);
  } catch (err) {
    console.error('getUserCars error:', err);
    return res.status(500).json({ error: 'Failed to fetch cars', details: err.message });
  }
};

// Get sync status and counts
exports.getMobileDeStatus = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { data: cred } = await supabase
      .from('mobile_de_credentials')
      .select('last_sync_at')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: countRows, error: countErr } = await supabase
      .from('mobile_de_listings')
      .select('mobile_ad_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('provider', 'mobile_de');
    const total_listings = (countRows && Array.isArray(countRows)) ? countRows.length : (countRows?.length || null);

    const { data: latest } = await supabase
      .from('mobile_de_listings')
      .select('first_seen')
      .eq('user_id', userId)
      .eq('provider', 'mobile_de')
      .order('first_seen', { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.json({
      last_sync_at: cred?.last_sync_at || null,
      latest_first_seen: latest?.first_seen || null,
      total_listings: total_listings,
    });
  } catch (err) {
    console.error('getMobileDeStatus error:', err);
    return res.status(500).json({ error: 'Failed to get status', details: err.message });
  }
};

// List recent listings
exports.getMobileDeListings = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

    // Trigger a background refresh without blocking the response
    maybeStartBackgroundSync(userId);

    const { data, error } = await supabase
      .from('mobile_de_listings')
      .select('mobile_ad_id, first_seen, last_seen, details, image_xxxl_url, images')
      .eq('user_id', userId)
      .eq('provider', 'mobile_de')
      .order('first_seen', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    console.error('getMobileDeListings error:', err);
    return res.status(500).json({ error: 'Failed to get listings', details: err.message });
  }
};

// Distinct makes and models for current dealership (from cached listings)
exports.getMobileDeFilters = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    // Load dealer credentials
    const credRes = await supabase
      .from('mobile_de_credentials')
      .select('username, encrypted_password')
      .eq('user_id', userId)
      .eq('provider', 'mobile_de')
      .maybeSingle();
    if (credRes.error || !credRes.data) {
      return res.status(404).json({ error: 'No credentials found' });
    }
    const [iv, encryptedPassword] = credRes.data.encrypted_password.split(':');
    const password = decrypt(encryptedPassword, iv);
    const username = credRes.data.username;

    const wantedMakeRaw = typeof req.query.make === 'string' ? req.query.make : undefined;
    const wantedMake = wantedMakeRaw ? String(wantedMakeRaw).toUpperCase() : undefined;

    // Enumerate inventory directly from mobile.de API (all pages)
    const makes = new Set();
    const models = new Set();
    const pageSize = 100;
    let page = 1;

    while (true) {
      const data = await fetchMobileDeListings(username, password, {
        'page.number': page,
        'page.size': pageSize,
        'sort.field': 'makeModel',
        'sort.order': 'ASCENDING',
      });
      const ads = Array.isArray(data?.['search-result']?.ads?.ad)
        ? data['search-result'].ads.ad
        : [];
      if (!ads.length) break;

      for (const ad of ads) {
        const make = (ad?.vehicle?.make?.['@key'] || ad?.vehicle?.make || ad?.make || '').toString().toUpperCase();
        const model = (ad?.vehicle?.model?.['@key'] || ad?.vehicle?.model || ad?.model || '').toString().toUpperCase();
        if (make) makes.add(make);
        if (wantedMake && make === wantedMake && model) models.add(model);
      }

      if (ads.length < pageSize) break;
      page += 1;
    }

    const result = { makes: Array.from(makes).sort() };
    if (wantedMake) Object.assign(result, { models: Array.from(models).sort() });
    return res.json(result);
  } catch (err) {
    console.error('getMobileDeFilters error:', err);
    return res.status(500).json({ error: 'Failed to get filters', details: err.message });
  }
};

// Seed a dummy listing and enqueue social jobs (testing helper)
exports.seedDummyListing = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { mobile_ad_id, images = [], make = 'MERCEDES-BENZ', model = 'C 43 AMG', detail_url, caption } = req.body || {};
    const adId = String(mobile_ad_id || `dummy-${Date.now()}`);
    const imagesArr = Array.isArray(images) ? images.filter(Boolean).slice(0, 10) : [];
    const image_xxxl_url = imagesArr[0] || null;

    await supabase
      .from('mobile_de_listings')
      .upsert({
        user_id: userId,
        mobile_ad_id: adId,
        details: { make, model, detailPageUrl: detail_url || null },
        image_xxxl_url,
        images: imagesArr.length ? imagesArr : null,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });

    const baseCaption = `${make} ${model}`.trim();
    const payload = {
      images: imagesArr,
      caption: caption || baseCaption,
      detail_url: detail_url || null,
      make,
      model,
    };

    // enqueue for fb and ig
    for (const platform of ['facebook', 'instagram']) {
      await supabase
        .from('social_post_jobs')
        .insert({ user_id: userId, platform, mobile_ad_id: adId, payload });
    }

    return res.json({ seeded: true, mobile_ad_id: adId, images: imagesArr.length });
  } catch (err) {
    console.error('seedDummyListing error:', err);
    return res.status(500).json({ error: 'Failed to seed dummy listing', details: err.message });
  }
};

// Sync new listings and enqueue social posts
exports.syncMobileDe = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const result = await performMobileDeSyncForUser(userId);
    if (result.reason === 'no_credentials') {
      return res.status(404).json({ error: 'No mobile.de credentials found' });
    }
    return res.json(result);
  } catch (err) {
    console.error('syncMobileDe error:', err);
    return res.status(500).json({ error: 'Failed to sync mobile.de', details: err.message });
  }
};