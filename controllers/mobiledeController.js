// controllers/mobiledeController.js
const supabase = require('../config/supabaseClient');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt, decrypt } = require('../utils/crypto');
const axios = require('axios');

async function fetchMobileDeListings(username, password) {
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const response = await axios.get('https://services.mobile.de/search-api/search', {
    headers: { Authorization: auth, Accept: 'application/vnd.de.mobile.api+json' },
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
        { user_id: userId, username, encrypted_password: `${iv}:${encryptedData}` },
        { onConflict: ['user_id'] }
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
      .single();

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
      .update({ username, encrypted_password: `${iv}:${encryptedData}` })
      .eq('user_id', userId);

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
      .delete()
      .eq('user_id', userId);

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

    const response = await axios.get('https://services.mobile.de/search-api/search', {
      headers: { Authorization: auth, Accept: 'application/vnd.de.mobile.api+json' },
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
      .eq('user_id', userId);
    const total_listings = (countRows && Array.isArray(countRows)) ? countRows.length : (countRows?.length || null);

    const { data: latest } = await supabase
      .from('mobile_de_listings')
      .select('first_seen')
      .eq('user_id', userId)
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

    const { data, error } = await supabase
      .from('mobile_de_listings')
      .select('mobile_ad_id, first_seen, last_seen, details, image_xxxl_url')
      .eq('user_id', userId)
      .order('first_seen', { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    console.error('getMobileDeListings error:', err);
    return res.status(500).json({ error: 'Failed to get listings', details: err.message });
  }
};

// Sync new listings and enqueue social posts
exports.syncMobileDe = async (req, res) => {
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
      return res.status(404).json({ error: 'No mobile.de credentials found' });
    }
    const [iv, encryptedPassword] = credRes.data.encrypted_password.split(':');
    const password = decrypt(encryptedPassword, iv);
    const username = credRes.data.username;

    // Fetch current listings
    const searchData = await fetchMobileDeListings(username, password);
    const ads = Array.isArray(searchData?.['search-result']?.ads?.ad)
      ? searchData['search-result'].ads.ad
      : [];

    let newCount = 0;
    for (const ad of ads) {
      const mobileAdId = String(ad.id || ad.mobileAdId || ad['mobile-ad-id'] || '').trim();
      if (!mobileAdId) continue;

      // Upsert only if new
      const { data: existing } = await supabase
        .from('mobile_de_listings')
        .select('mobile_ad_id')
        .eq('user_id', userId)
        .eq('mobile_ad_id', mobileAdId)
        .maybeSingle();
      if (existing) {
        // Update last_seen
        await supabase
          .from('mobile_de_listings')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('mobile_ad_id', mobileAdId);
        continue;
      }

      // Fetch full details for new ad
      let details = null;
      let image_xxxl_url = null;
      try {
        details = await fetchMobileDeDetails(username, password, mobileAdId);
        const imgs = Array.isArray(details?.images) ? details.images : [];
        // Always prefer xxxl as requested
        image_xxxl_url = imgs.find(i => i?.xxxl)?.xxxl || null;
      } catch (e) {
        // Continue even if details fail; we still store the ad id
      }

      await supabase
        .from('mobile_de_listings')
        .insert({
          user_id: userId,
          mobile_ad_id: mobileAdId,
          details,
          image_xxxl_url,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        });

      // Enqueue social posts (facebook + instagram if linked)
      const platforms = ['facebook', 'instagram'];
      for (const platform of platforms) {
        await supabase
          .from('social_post_jobs')
          .insert({
            user_id: userId,
            platform,
            mobile_ad_id: mobileAdId,
            payload: {
              image_url: image_xxxl_url || null,
              caption: `${details?.make || ad.make || ''} ${details?.model || ad.model || ''}`.trim(),
              detail_url: details?.detailPageUrl || ad.detailPageUrl || null,
            },
          });
      }
      newCount += 1;
    }

    // Update last_sync_at
    await supabase
      .from('mobile_de_credentials')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('user_id', userId);

    return res.json({ synced: true, new_listings: newCount, total_seen: ads.length });
  } catch (err) {
    console.error('syncMobileDe error:', err);
    return res.status(500).json({ error: 'Failed to sync mobile.de', details: err.message });
  }
};