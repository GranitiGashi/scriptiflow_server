const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const querystring = require('querystring');
const supabase = require('../config/supabaseClient');
const { upsertSocialRecord, getSocialAccountsByUserId, getUserByEmail } = require('../models/socialModel');

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'scriptiflow-server.onrender.com';

exports.getFbLoginUrl = async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  const stateData = { user_id, nonce: uuidv4() };
  const state = encodeURIComponent(JSON.stringify(stateData));
  const redirect_uri = `https://${BASE_DOMAIN}/api/fb/callback`;

  const authUrl =
    `https://www.facebook.com/v19.0/dialog/oauth?` +
    querystring.stringify({
      client_id: FB_APP_ID,
      redirect_uri,
      state,
      scope: 'pages_show_list,instagram_basic,pages_read_engagement,pages_manage_posts,instagram_manage_insights,instagram_content_publish',
    });

  console.log('Generated auth URL:', authUrl); // Debug
  return res.json({ auth_url: authUrl });
};

exports.fbCallback = async (req, res) => {
  const { code, state, error, error_message } = req.query;
  if (error) {
    console.error('OAuth error:', { error, error_message });
    return res.status(400).json({ error: error_message || 'Unknown error' });
  }

  let user_id;
  try {
    const decodedState = decodeURIComponent(state);
    const stateData = JSON.parse(decodedState);
    user_id = stateData.user_id;
    if (!user_id) throw new Error('Missing user_id in state');
  } catch (e) {
    console.error('State parsing error:', e.message);
    return res.status(400).json({ error: `Invalid state parameter: ${e.message}` });
  }

  const redirect_uri = `https://${BASE_DOMAIN}/api/fb/callback`;

  try {
    // Step 1: Get short-lived User Access Token
    const shortTokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: FB_APP_ID,
        redirect_uri,
        client_secret: FB_APP_SECRET,
        code,
      },
    });
    const shortToken = shortTokenRes.data.access_token;
    console.log('Short-lived User Access Token:', shortToken);

    // Step 2: Exchange for long-lived User Access Token
    const longTokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortToken,
      },
    });
    const longToken = longTokenRes.data.access_token;
    console.log('Long-lived User Access Token:', longTokenRes.data); // Log to verify expiration

    // Step 3: Get Pages with Extended Page Access Tokens
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: {
        fields: 'id,name,access_token',
        access_token: longToken,
      },
    });
    const pages = pagesRes.data.data || [];
    console.log('Pages response:', pages);

    if (!pages.length) {
      console.error('No Facebook Pages found for user');
      return res.status(400).json({ error: 'No Facebook Pages found' });
    }

    const page = pages[0]; // Save the first page
    const page_id = page.id;
    const page_access_token = page.access_token; // Non-expiring Page Access Token
    console.log('Selected Page:', { page_id, name: page.name });

    // Step 4: Get Instagram Business Account linked to the page
    let ig_id = null;
    try {
      const igRes = await axios.get(`https://graph.facebook.com/v19.0/${page_id}`, {
        params: {
          fields: 'instagram_business_account',
          access_token: page_access_token,
        },
      });
      console.log('Instagram API response:', igRes.data);
      if (igRes.data.instagram_business_account && igRes.data.instagram_business_account.id) {
        ig_id = igRes.data.instagram_business_account.id;
        console.log('Found Instagram Business Account:', ig_id);
      } else {
        console.log('No Instagram Business Account linked to Facebook Page:', page_id);
      }
    } catch (err) {
      console.error('Failed to fetch Instagram Business Account:', err.response?.data || err.message);
    }

    // Step 5: Save Facebook social account
    try {
      await upsertSocialRecord({
        user_id,
        provider: 'facebook',
        account_id: page_id,
        access_token: page_access_token,
        metadata: { page: { id: page_id, name: page.name } },
      });
      console.log('Saved Facebook account:', { user_id, page_id });
    } catch (err) {
      console.error('Failed to save Facebook account:', err);
      throw err; // Fail if Facebook save fails
    }

    // Step 6: Save Instagram social account if exists
    if (ig_id) {
      try {
        await upsertSocialRecord({
          user_id,
          provider: 'instagram',
          account_id: ig_id,
          access_token: page_access_token, // Use same Page Access Token for Instagram
          metadata: { linked_fb_page_id: page_id },
        });
        console.log('Saved Instagram account:', { user_id, ig_id });
      } catch (err) {
        console.error('Failed to save Instagram account:', err);
      }
    } else {
      console.log('Skipping Instagram account save: No ig_id found');
    }

    // Redirect to frontend with success
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/connect?status=success`);
  } catch (err) {
    console.error('Facebook callback error:', err.response?.data || err.message);
    return res.redirect(
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}/connect?status=error&message=${encodeURIComponent(
        'Failed to connect Facebook'
      )}`
    );
  }
};

exports.getSocialAccounts = async (req, res) => {
  const user_id = req.user?.id || req.query.user_id;
  if (!user_id) return res.status(401).json({ error: 'Missing user_id' });

  try {
    const accounts = await getSocialAccountsByUserId(user_id);
    const fbAccount = accounts.find((acc) => acc.provider === 'facebook');
    const igAccount = accounts.find((acc) => acc.provider === 'instagram');

    return res.json({
      facebook_id: fbAccount?.account_id || null,
      instagram_id: igAccount?.account_id || null,
    });
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
    if (!user) return res.status(404).json({ error: 'User not found' });

    const accounts = await getSocialAccountsByUserId(user.id);
    if (!accounts.length) return res.status(404).json({ error: 'No social accounts found for this user' });

    const fbAccount = accounts.find((acc) => acc.provider === 'facebook');
    const igAccount = accounts.find((acc) => acc.provider === 'instagram');

    return res.json({
      email,
      facebook_id: fbAccount?.account_id || null,
      instagram_id: igAccount?.account_id || null,
      access_token_fb: fbAccount?.access_token || null,
    });
  } catch (err) {
    console.error('getSocialAccountsByEmail error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};