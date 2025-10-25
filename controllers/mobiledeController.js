// controllers/mobiledeController.js
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt, decrypt } = require('../utils/crypto');
const axios = require('axios');
const openai = require('../utils/openaiClient');
// const supabaseAdmin = require('../config/supabaseAdmin');

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

// Preferred: fetch a single ad by ID (richer images incl. xxxl)
async function fetchMobileDeAdById(username, password, mobileAdId) {
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const response = await axios.get(`https://services.mobile.de/search-api/ad/${encodeURIComponent(mobileAdId)}`, {
    headers: { Authorization: auth, Accept: 'application/vnd.de.mobile.api+json' },
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    throw new Error(`mobile.de ad fetch failed: ${response.status} ${body}`);
  }
  return response.data;
}

// Generate AI caption for car post
async function generateCarCaption(make, model, details = {}) {
  try {
    const prompt = `Create an engaging social media caption for a car listing. 
    
Car Details:
- Make: ${make}
- Model: ${model}
- Additional Info: ${JSON.stringify(details)}

Requirements:
- Keep it under 200 characters
- Make it engaging and professional
- Include relevant hashtags
- Focus on the car's appeal
- Use emojis sparingly but effectively

Generate a compelling caption that would make people want to learn more about this car:`;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.7,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.log('OpenAI caption generation failed:', error.message);
    // Fallback to basic caption
    return `${make} ${model} - Check out this amazing vehicle! 🚗 #${make.replace(/\s+/g, '')} #${model.replace(/\s+/g, '')} #Cars #AutoDealer`;
  }
}

// Clean controller - removed old sync functions

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
        { 
          user_id: userId, 
          provider: 'mobile_de', 
          username, 
          encrypted_password: `${iv}:${encryptedData}`, 
          deleted_at: null,
          last_sync_at: new Date().toISOString()
        },
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
      .select('username, last_sync_at')
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

    const username = String(data.username || '');
    // Mask username/email for display
    const at = username.indexOf('@');
    let masked = username;
    if (at > 1) {
      const name = username.slice(0, at);
      const domain = username.slice(at);
      const visible = name.slice(0, Math.min(2, name.length));
      masked = `${visible}${'*'.repeat(Math.max(0, name.length - visible.length))}${domain}`;
    } else if (username.length > 4) {
      masked = `${username.slice(0, 2)}${'*'.repeat(username.length - 4)}${username.slice(-2)}`;
    }

    res.json({ connected: true, username: masked, last_sync_at: data.last_sync_at || null });
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

// Get details for a specific mobile.de ad, including images (prefer remote /ad/:id; fallback to cache)
exports.getMobileDeAdDetails = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const adIdRaw = req.query.mobile_ad_id || req.query.id || req.query.adId;
    const mobileAdId = typeof adIdRaw === 'string' ? adIdRaw : null;
    if (!mobileAdId) return res.status(400).json({ error: 'mobile_ad_id is required' });

    // Try remote /ad/:id first for full image set (xxxl)
    try {
      const credRes = await supabase
        .from('mobile_de_credentials')
        .select('username, encrypted_password')
        .eq('user_id', userId)
        .eq('provider', 'mobile_de')
        .is('deleted_at', null)
        .maybeSingle();
      if (credRes.error || !credRes.data) throw new Error('No credentials');
      const [iv, encryptedPassword] = credRes.data.encrypted_password.split(':');
      const password = decrypt(encryptedPassword, iv);
      const username = credRes.data.username;

      const ad = await fetchMobileDeAdById(username, password, mobileAdId);
      const imgs = Array.isArray(ad?.images) ? ad.images : [];
      const images = imgs
        .map((i) => i?.xxxl || i?.xxl || i?.xl || i?.l || i?.m || i?.s)
        .filter(Boolean);
      return res.json({
        mobile_ad_id: mobileAdId,
        images,
        make: ad?.make || ad?.vehicle?.make || null,
        model: ad?.model || ad?.vehicle?.model || null,
        detail_url: ad?.detailPageUrl || null,
        source: 'remote',
      });
    } catch (_) {
      // Fallback to cached listing
      const { data: row, error } = await supabase
        .from('mobile_de_listings')
        .select('details, image_xxxl_url, images')
        .eq('user_id', userId)
        .eq('provider', 'mobile_de')
        .eq('mobile_ad_id', mobileAdId)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!row) return res.json({ mobile_ad_id: mobileAdId, images: [], make: null, model: null, detail_url: null, source: 'cache_miss' });
      const details = row.details || {};
      const listImages = Array.isArray(row.images) ? row.images : [];
      const primary = row.image_xxxl_url || null;
      const images = (listImages.length ? listImages : (primary ? [primary] : []));
      return res.json({
        mobile_ad_id: mobileAdId,
        images,
        make: details?.make || details?.vehicle?.make || null,
        model: details?.model || details?.vehicle?.model || null,
        detail_url: details?.detailPageUrl || null,
        source: 'cache',
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch ad details', details: err.message });
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

    // Use the same approach as getUserCars but with larger page size to get all cars
    const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    
    // Get all cars with a large page size
    const response = await axios.get('https://services.mobile.de/search-api/search', {
      headers: { Authorization: auth, Accept: 'application/vnd.de.mobile.api+json' },
      params: {
        'page.number': 1,
        'page.size': 1000, // Get more cars to extract makes/models
        'sort.field': 'makeModel',
        'sort.order': 'ASCENDING',
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({ error: 'mobile.de request failed', status: response.status, body: response.data });
    }

    const data = response.data;
    const rawCars = Array.isArray(data?.['search-result']?.ads?.ad)
      ? data['search-result'].ads.ad
      : Array.isArray(data?.ads)
      ? data.ads
      : Array.isArray(data)
      ? data
      : [];

    // Extract makes and models
    const makes = new Set();
    const models = new Set();

    for (const ad of rawCars) {
      const make = (ad?.vehicle?.make?.['@key'] || ad?.vehicle?.make || ad?.make || '').toString().trim();
      const model = (ad?.vehicle?.model?.['@key'] || ad?.vehicle?.model || ad?.model || '').toString().trim();
      
      if (make) makes.add(make);
      if (wantedMake && make.toUpperCase() === wantedMake && model) {
        models.add(model);
      }
    }

    const result = { makes: Array.from(makes).sort() };
    if (wantedMake) {
      result.models = Array.from(models).sort();
    }
    
    console.log('Mobile.de filters result:', result);
    console.log('Total cars processed:', rawCars.length);
    console.log('Unique makes found:', Array.from(makes).sort());
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
    const imagesArr = Array.isArray(images) ? images.filter(Boolean).slice(0, 50) : [];
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

// Manual trigger for auto-posting (replaces old sync)
exports.syncMobileDe = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const result = await checkForNewCarsAndPost(userId);
    if (result.reason === 'no_credentials') {
      return res.status(404).json({ error: 'No mobile.de credentials found' });
    }
    return res.json(result);
  } catch (err) {
    console.error('syncMobileDe error:', err);
    return res.status(500).json({ error: 'Failed to sync mobile.de', details: err.message });
  }
};

// Check for new cars and create posts (hourly job)
async function checkForNewCarsAndPost(userId) {
  try {
    console.log(`Checking for new cars for user ${userId}`);
    
    // Get user credentials
    const credRes = await supabaseAdmin
      .from('mobile_de_credentials')
      .select('username, encrypted_password, last_sync_at, created_at')
      .eq('user_id', userId)
      .eq('provider', 'mobile_de')
      .is('deleted_at', null)
      .maybeSingle();
    
    if (credRes.error || !credRes.data) {
      console.log(`No credentials found for user ${userId}`);
      return { success: false, reason: 'no_credentials' };
    }

    const [iv, encryptedPassword] = credRes.data.encrypted_password.split(':');
    const password = decrypt(encryptedPassword, iv);
    const username = credRes.data.username;
    const lastSyncAt = credRes.data.last_sync_at;
    const createdAt = credRes.data.created_at;

    // Use created_at as the baseline if no last_sync_at exists
    const syncDate = lastSyncAt || createdAt;
    console.log(`Sync date for user ${userId}: ${syncDate}`);

    // Fetch ALL listings from mobile.de (paginate through all pages)
    const pageSize = 100;
    let page = 1;
    let allAds = [];
    let hasMorePages = true;

    console.log(`Fetching all cars from mobile.de for user ${userId}...`);

    while (hasMorePages) {
      const searchData = await fetchMobileDeListings(username, password, {
        'page.number': page,
        'page.size': pageSize,
        'sort.field': 'creationDate',
        'sort.order': 'DESCENDING',
      });

      const ads = Array.isArray(searchData?.ads)
        ? searchData.ads
        : Array.isArray(searchData?.['search-result']?.ads?.ad)
        ? searchData['search-result'].ads.ad
        : [];

      if (!ads.length) {
        hasMorePages = false;
        break;
      }

      allAds = allAds.concat(ads);
      console.log(`Fetched page ${page}: ${ads.length} cars (total: ${allAds.length})`);

      if (ads.length < pageSize) {
        hasMorePages = false;
      } else {
        page++;
      }
    }

    console.log(`Total cars fetched: ${allAds.length}`);

    if (!allAds.length) {
      console.log(`No cars found for user ${userId}`);
      return { success: true, new_posts: 0, total_checked: 0 };
    }

    let newPostsCreated = 0;
    const postsToCreate = [];

    // Check ALL cars and find new ones
    console.log(`Checking ${allAds.length} cars against sync date: ${syncDate}`);
    
    for (const ad of allAds) {
      const mobileAdId = String(ad.mobileAdId || '').trim();
      if (!mobileAdId) continue;

      // Get creation date from the ad
      const creationDate = ad.creationDate;
      if (!creationDate) continue;

      const adCreationDate = new Date(creationDate);
      const syncDateObj = new Date(syncDate);

      // ONLY process cars that are newer than our sync date
      if (adCreationDate > syncDateObj) {
        // Check if we already processed this car
        const { data: existingListing } = await supabaseAdmin
          .from('mobile_de_listings')
          .select('mobile_ad_id')
          .eq('user_id', userId)
          .eq('provider', 'mobile_de')
          .eq('mobile_ad_id', mobileAdId)
          .maybeSingle();

        if (existingListing) {
          console.log(`⏭️  Car ${mobileAdId} already processed, skipping`);
          continue;
        }

        console.log(`✅ NEW CAR FOUND: ${mobileAdId}`);
        console.log(`  Car creationDate: ${creationDate} (${adCreationDate.toISOString()})`);
        console.log(`  DB sync date: ${syncDate} (${syncDateObj.toISOString()})`);
        console.log(`  Time difference: ${Math.round((adCreationDate - syncDateObj) / (1000 * 60))} minutes newer`);
        
        // Get full details for the new car
        let details = null;
        let image_xxxl_url = null;
        let imagesArr = [];
        
        try {
          details = await fetchMobileDeDetails(username, password, mobileAdId);
          const imgs = Array.isArray(details?.images) ? details.images : [];
          image_xxxl_url = imgs.find(i => i?.xxxl)?.xxxl || null;
          imagesArr = imgs.map(i => i?.xxxl || i?.xxl || i?.xl || i?.l || i?.m || i?.s).filter(Boolean);
        } catch (e) {
          console.log(`Failed to get details for ${mobileAdId}:`, e.message);
          // Continue with basic info from search result
          details = {
            make: ad.make || ad?.vehicle?.make || '',
            model: ad.model || ad?.vehicle?.model || '',
            detailPageUrl: ad.detailPageUrl || null
          };
        }

        // Get images from search result if details failed
        if (!imagesArr.length && ad.images) {
          const searchImages = Array.isArray(ad.images) ? ad.images : [];
          imagesArr = searchImages.map(img => img?.xxxl || img?.xxl || img?.xl || img?.l || img?.m || img?.s).filter(Boolean);
        }

        // Limit to first 10 images
        imagesArr = imagesArr.slice(0, 10);

        // Store the listing in our database
        const mergedDetails = {
          ...(details || {}),
          make: (details?.make || details?.vehicle?.make || ad.make || ad?.vehicle?.make || null),
          model: (details?.model || details?.vehicle?.model || ad.model || ad?.vehicle?.model || null),
          detailPageUrl: (details?.detailPageUrl || ad.detailPageUrl || null),
        };

        await supabaseAdmin
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

        // Generate AI caption
        const make = (details?.make || details?.vehicle?.make || ad.make || ad?.vehicle?.make || '').toString().trim();
        const model = (details?.model || details?.vehicle?.model || ad.model || ad?.vehicle?.model || '').toString().trim();
        
        console.log(`🤖 Generating AI caption for ${make} ${model}...`);
        const aiCaption = await generateCarCaption(make, model, details);
        console.log(`✅ Generated caption: ${aiCaption.substring(0, 50)}...`);

        // Ensure we have at least one image
        const finalImages = imagesArr.length ? imagesArr : (image_xxxl_url ? [image_xxxl_url] : []);
        
        if (!finalImages.length) {
          console.log(`⚠️  No images found for ${mobileAdId}, skipping post creation`);
          continue;
        }

        // Prepare post data
        const postData = {
          user_id: userId,
          mobile_ad_id: mobileAdId,
          images: finalImages,
          caption: aiCaption,
          detail_url: details?.detailPageUrl || ad.detailPageUrl || null,
          make: make,
          model: model,
          created_at: creationDate
        };

        postsToCreate.push(postData);
        newPostsCreated++;
      } else {
        // Car is not newer - skip it
        console.log(`⏭️  Car ${mobileAdId} is older (created: ${creationDate})`);
      }
    }

    // Create social posts for all new cars
    if (postsToCreate.length > 0) {
      console.log(`Creating ${postsToCreate.length} social posts for user ${userId}`);
      
      for (const postData of postsToCreate) {
        // Create posts for Facebook and Instagram
        for (const platform of ['facebook', 'instagram']) {
          await supabaseAdmin
            .from('social_post_jobs')
            .insert({
              user_id: userId,
              platform,
              mobile_ad_id: postData.mobile_ad_id,
              payload: {
                images: postData.images,
                caption: postData.caption,
                detail_url: postData.detail_url,
                make: postData.make,
                model: postData.model,
                created_at: postData.created_at
              },
            });
        }
      }
    }

    // Update the sync date to current time
    await supabaseAdmin
      .from('mobile_de_credentials')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', 'mobile_de');

    console.log(`\n📊 AUTO-POSTING SUMMARY for user ${userId}:`);
    console.log(`  Total cars checked: ${allAds.length}`);
    console.log(`  New cars found: ${newPostsCreated}`);
    console.log(`  Social posts created: ${postsToCreate.length * 2} (Facebook + Instagram)`);
    console.log(`  Sync date updated to: ${new Date().toISOString()}`);
    
    return { 
      success: true, 
      new_posts: newPostsCreated, 
      total_checked: allAds.length,
      posts_created: postsToCreate.length
    };

  } catch (err) {
    console.error(`Auto-posting failed for user ${userId}:`, err);
    return { success: false, error: err.message };
  }
}

// Manual trigger for auto-posting check
exports.triggerAutoPosting = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const result = await checkForNewCarsAndPost(userId);
    return res.json(result);
  } catch (err) {
    console.error('triggerAutoPosting error:', err);
    return res.status(500).json({ error: 'Failed to trigger auto-posting', details: err.message });
  }
};

// Worker function to check all users with mobile.de credentials
exports.runAutoPostingForAllUsers = async () => {
  try {
    console.log('Starting auto-posting check for all users...');
    
    // Get all users with mobile.de credentials
    const { data: users, error } = await supabaseAdmin
      .from('mobile_de_credentials')
      .select('user_id')
      .eq('provider', 'mobile_de')
      .is('deleted_at', null);

    if (error) {
      console.error('Failed to get users:', error);
      return { success: false, error: error.message };
    }

    if (!users || users.length === 0) {
      console.log('No users with mobile.de credentials found');
      return { success: true, users_processed: 0 };
    }

    console.log(`Found ${users.length} users with mobile.de credentials`);

    const results = [];
    let totalNewPosts = 0;

    // Process each user
    for (const user of users) {
      try {
        console.log(`Processing user ${user.user_id}...`);
        const result = await checkForNewCarsAndPost(user.user_id);
        results.push({ user_id: user.user_id, ...result });
        
        if (result.success && result.new_posts) {
          totalNewPosts += result.new_posts;
        }
      } catch (err) {
        console.error(`Failed to process user ${user.user_id}:`, err);
        results.push({ 
          user_id: user.user_id, 
          success: false, 
          error: err.message 
        });
      }
    }

    console.log(`Auto-posting completed for ${users.length} users. Total new posts: ${totalNewPosts}`);
    return { 
      success: true, 
      users_processed: users.length,
      total_new_posts: totalNewPosts,
      results 
    };

  } catch (err) {
    console.error('runAutoPostingForAllUsers error:', err);
    return { success: false, error: err.message };
  }
};

// Expose for worker
exports.checkForNewCarsAndPost = checkForNewCarsAndPost;