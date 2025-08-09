const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const querystring = require('querystring');
const supabase = require('../config/supabaseClient');
const { upsertSocialRecord, getSocialAccountsByUserId, getUserByEmail } = require('../models/socialModel');

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const BASE_DOMAIN = 'scriptiflow-server.onrender.com';  // e.g. yourdomain.com

exports.getFbLoginUrl = async (req, res) => {
  const user_id = req.query.user_id;
  if (!user_id) return res.status(400).json({ error: "Missing user_id query parameter" });

  const stateData = { user_id, nonce: uuidv4() };
  const state = encodeURIComponent(JSON.stringify(stateData));
  const redirect_uri = `https://${BASE_DOMAIN}/api/fb/callback`;

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?` +
    querystring.stringify({
      client_id: FB_APP_ID,
      redirect_uri,
      state,
      scope: 'pages_show_list,pages_manage_posts'
    });

  return res.json({ auth_url: authUrl, state });
};


exports.fbCallback = async (req, res) => {
  const { code, state, error, error_message } = req.query;
  if (error) return res.status(400).json({ error: error_message || 'Unknown error' });

  let user_id;
  try {
    const decodedState = decodeURIComponent(state);
    const stateData = JSON.parse(decodedState);
    user_id = stateData.user_id;
    if (!user_id) throw new Error('Missing user_id in state');
  } catch (e) {
    return res.status(400).json({ error: `Invalid state parameter: ${e.message}` });
  }

  const redirect_uri = `https://${BASE_DOMAIN}/api/fb/callback`;

  try {
    // Step 1: Get short-lived token
    const shortTokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: FB_APP_ID,
        redirect_uri,
        client_secret: FB_APP_SECRET,
        code,
      }
    });
    const shortToken = shortTokenRes.data.access_token;

    // Step 2: Exchange for long-lived token
    const longTokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortToken,
      }
    });
    const longToken = longTokenRes.data.access_token;

    // Step 3: Get Pages
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: longToken }
    });
    const pages = pagesRes.data.data || [];

    if (!pages.length) {
      return res.status(400).json({ error: 'No Facebook Pages found' });
    }

    const page = pages[0];
    const page_id = page.id;
    const page_token = page.access_token;

    // Step 4: Get Instagram Business Account linked to the page (optional)
    let ig_id = null;
    try {
      const igRes = await axios.get(`https://graph.facebook.com/v19.0/${page_id}`, {
        params: { fields: 'instagram_business_account', access_token: page_token }
      });
      ig_id = igRes.data.instagram_business_account?.id || null;
    } catch (_) {
      // Ignore IG errors, it's optional
    }

    // Step 5: Save Facebook social account
    await upsertSocialRecord({
      user_id,
      provider: 'facebook',
      account_id: page_id,
      access_token: page_token,
      metadata: { page }
    });

    // Step 6: Save Instagram social account if exists
    if (ig_id) {
      await upsertSocialRecord({
        user_id,
        provider: 'instagram',
        account_id: ig_id,
        access_token: page_token,
        metadata: { linked_fb_page_id: page_id }
      });
    }

    return res.json({
      status: 'connected',
      facebook_id: page_id,
      instagram_id: ig_id,
      access_token: page_token
    });
  } catch (err) {
    console.error('Facebook callback error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


exports.getSocialAccounts = async (req, res) => {
  // Assuming authMiddleware adds user info on req.user
  const user_id = req.user?.id;
  if (!user_id) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const accounts = await getSocialAccountsByUserId(user_id);
    return res.json({ accounts });
  } catch (err) {
    console.error('getSocialAccounts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


exports.getSocialAccountsByEmail = async (req, res) => {
  const email = req.query.email;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    const user = await getUserByEmail(email);
    const stateData = { user_id: user.id, nonce: uuidv4() }
    if (!user || !stateData) return res.status(404).json({ error: 'User not found' });

    const accounts = await getSocialAccountsByUserId(user.id);
    if (!accounts.length) return res.status(404).json({ error: 'No social accounts found for this user' });

    const fbAccount = accounts.find(acc => acc.provider === 'facebook');
    const igAccount = accounts.find(acc => acc.provider === 'instagram');

    return res.json({
      email,
      facebook_id: fbAccount?.account_id || null,
      instagram_id: igAccount?.account_id || null,
      access_token_fb: fbAccount?.access_token || null
    });
  } catch (err) {
    console.error('getSocialAccountsByEmail error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
