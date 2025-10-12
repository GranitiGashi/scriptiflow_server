const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const querystring = require('querystring');
const supabase = require('../config/supabaseClient');
const { getUserFromRequest } = require('../utils/authUser');
const { upsertSocialRecord, getSocialAccountsByUserId, getUserByEmail } = require('../models/socialModel');
const { upsertFacebookUserToken } = require('../models/socialTokenModel');
const openai = require('../utils/openaiClient');
const { runOnce } = require('../worker/socialPoster');
require('dotenv').config();

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'scriptiflow-server.onrender.com';

exports.getFbLoginUrl = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Missing or invalid Authorization header for getFbLoginUrl');
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { user, error: tokenError } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (tokenError || !user) {
      console.error('Invalid token for getFbLoginUrl:', tokenError?.message || 'No user found');
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    const user_id = req.query.user_id || user.id;

    const stateData = { user_id, nonce: uuidv4() };
    const state = encodeURIComponent(JSON.stringify(stateData));
    const redirect_uri = `https://${BASE_DOMAIN}/api/fb/callback`;

    const authUrl =
      `https://www.facebook.com/v19.0/dialog/oauth?` +
      querystring.stringify({
        client_id: FB_APP_ID,
        redirect_uri,
        state,
        // Agency model: Focus on page access, not ad account access
        scope: [
          'pages_show_list',           // List their pages
          'pages_manage_posts',        // Post on their behalf  
          'pages_read_engagement',     // Read page insights
          'pages_manage_metadata',     // Manage page info
          'pages_manage_ads',          // Run ads from their pages
          'instagram_basic',           // Basic Instagram access
          'instagram_content_publish', // Post to Instagram
          'instagram_manage_insights', // Instagram insights
          // WhatsApp onboarding and messaging
          'whatsapp_business_management',
          'whatsapp_business_messaging',
          // Note: Removed ads_management, ads_read, business_management
          // These are not needed since we use OUR ad accounts
        ].join(','),
      });

    console.log('Generated auth URL:', authUrl);
    return res.json({ auth_url: authUrl, state });
  } catch (err) {
    console.error('getFbLoginUrl error:', err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
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
    const shortTokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: FB_APP_ID,
        redirect_uri,
        client_secret: FB_APP_SECRET,
        code,
      },
    });
    if (!shortTokenRes.data.access_token) {
      console.error('Failed to get short-lived token:', shortTokenRes.data);
      return res.status(400).json({ error: 'Failed to get short-lived token' });
    }
    const shortToken = shortTokenRes.data.access_token;
    console.log('Short-lived User Access Token:', shortToken);

    const longTokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortToken,
      },
    });
    if (!longTokenRes.data.access_token) {
      console.error('Failed to get long-lived token:', longTokenRes.data);
      return res.status(400).json({ error: 'Failed to get long-lived token' });
    }
    const longToken = longTokenRes.data.access_token;
    console.log('Long-lived User Access Token:', longTokenRes.data);

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

    const page = pages[0];
    const page_id = page.id;
    const page_access_token = page.access_token;
    console.log('Selected Page:', { page_id, name: page.name });

    let fb_profile_picture_url = null;
    try {
      const pictureRes = await axios.get(`https://graph.facebook.com/v19.0/${page_id}/picture`, {
        params: {
          redirect: false,
          access_token: page_access_token,
        },
      });
      fb_profile_picture_url = pictureRes.data.data?.url || null;
      console.log('Facebook Page profile picture:', fb_profile_picture_url);
    } catch (err) {
      console.error('Failed to fetch Facebook Page profile picture:', err.response?.data || err.message);
    }

    let ig_id = null;
    let ig_username = null;
    let ig_profile_picture_url = null;
    try {
      const igRes = await axios.get(`https://graph.facebook.com/v19.0/${page_id}`, {
        params: {
          fields: 'instagram_business_account{username,profile_picture_url}',
          access_token: page_access_token,
        },
      });
      console.log('Instagram API response:', igRes.data);
      if (igRes.status === 200 && igRes.data.instagram_business_account && igRes.data.instagram_business_account.id) {
        ig_id = igRes.data.instagram_business_account.id;
        ig_username = igRes.data.instagram_business_account.username;
        ig_profile_picture_url = igRes.data.instagram_business_account.profile_picture_url || null;
        console.log('Found Instagram Business Account:', { id: ig_id, username: ig_username, profile_picture_url: ig_profile_picture_url });
      } else {
        console.log('No Instagram Business Account linked to Facebook Page:', page_id);
      }
    } catch (err) {
      console.error('Failed to fetch Instagram Business Account:', err.response?.data || err.message);
    }

    try {
      // Store the long-lived USER token separately to avoid changing existing provider values
      await upsertFacebookUserToken(user_id, longToken, { scope: 'user', issued_at: new Date().toISOString() });

      await upsertSocialRecord({
        user_id,
        provider: 'facebook',
        account_id: page_id,
        access_token: page_access_token,
        metadata: {
          page,
          profile_picture_url: fb_profile_picture_url,
        },
      });
      console.log('Saved Facebook account:', { user_id, page_id, page_name: page.name });
    } catch (err) {
      console.error('Failed to save Facebook account:', err);
      throw err;
    }

    if (ig_id) {
      try {
        await upsertSocialRecord({
          user_id,
          provider: 'instagram',
          account_id: ig_id,
          access_token: page_access_token,
          metadata: {
            linked_fb_page_id: page_id,
            username: ig_username,
            profile_picture_url: ig_profile_picture_url,
          },
        });
        console.log('Saved Instagram account:', { user_id, ig_id, ig_username });
      } catch (err) {
        console.error('Failed to save Instagram account:', err);
      }
    } else {
      console.log('Skipping Instagram account save: No ig_id found');
    }

    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations`);
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
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];
  const refreshToken = req.headers['x-refresh-token'] || ''; // Get refresh_token from header

  try {
    // Verify Supabase JWT
    const { user, error: tokenError } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (tokenError || !user) {
      console.error('Token verification error:', tokenError?.message || 'No user found');
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Prefer explicit user_id, else fallback to authenticated user
    const user_id = req.query.user_id || user.id;

    // Set Supabase session for RLS
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: token,
      refresh_token: refreshToken || null, // Fallback to null if not provided
    });
    if (sessionError) {
      console.error('Supabase session error:', sessionError.message);
      return res.status(401).json({ error: 'Unauthorized: Failed to set session', details: sessionError.message });
    }

    try {
      const accounts = await getSocialAccountsByUserId(user_id);
      console.log('Fetched accounts:', accounts);
      const fbAccount = accounts.find((acc) => acc.provider === 'facebook');
      const igAccount = accounts.find((acc) => acc.provider === 'instagram');

      return res.json({
        facebook_id: fbAccount?.account_id || null,
        facebook_name: fbAccount?.metadata?.page?.name || null,
        facebook_profile_picture: fbAccount?.metadata?.profile_picture_url || null,
        instagram_id: igAccount?.account_id || null,
        instagram_username: igAccount?.metadata?.username || null,
        instagram_profile_picture: igAccount?.metadata?.profile_picture_url || null,
      });
    } catch (err) {
      console.error('getSocialAccounts error:', err.message, err.stack);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  } catch (err) {
    console.error('Token verification error:', err.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid token', details: err.message });
  }
};

// Soft delete social account
exports.disconnectSocial = async (req, res) => {
  try {
    const { user, error: tokenError } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (tokenError || !user) return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    const provider = (req.body?.provider || req.query?.provider || '').toLowerCase();
    if (!['facebook', 'instagram'].includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    const accountId = (req.body?.account_id || req.query?.account_id || '').toString();
    // If accountId not specified, soft delete all for that provider
    const q = supabase.from('social_accounts')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('provider', provider);
    const { error } = accountId ? await q.eq('account_id', accountId) : await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ disconnected: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to disconnect social account' });
  }
};

exports.getSocialAccountsByEmail = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Missing or invalid Authorization header for getSocialAccountsByEmail');
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { user, error: tokenError } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (tokenError || !user) {
      console.error('Invalid token for getSocialAccountsByEmail:', tokenError?.message || 'No user found');
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    const email = req.query.email;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const userByEmail = await getUserByEmail(email);
    if (!userByEmail) return res.status(404).json({ error: 'User not found' });

    if (user.id !== userByEmail.id) {
      console.error('User ID mismatch in getSocialAccountsByEmail:', { token_user_id: user.id, email_user_id: userByEmail.id });
      return res.status(403).json({ error: 'Forbidden: User ID mismatch' });
    }

    const accounts = await getSocialAccountsByUserId(userByEmail.id);
    if (!accounts.length) return res.status(404).json({ error: 'No social accounts found for this user' });

    const fbAccount = accounts.find((acc) => acc.provider === 'facebook');
    const igAccount = accounts.find((acc) => acc.provider === 'instagram');

    return res.json({
      email,
      facebook_id: fbAccount?.account_id || null,
      facebook_name: fbAccount?.metadata?.page?.name || null,
      facebook_profile_picture: fbAccount?.metadata?.profile_picture_url || null,
      instagram_id: igAccount?.account_id || null,
      instagram_username: igAccount?.metadata?.username || null,
      instagram_profile_picture: igAccount?.metadata?.profile_picture_url || null,
    });
  } catch (err) {
    console.error('getSocialAccountsByEmail error:', err.message);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};

// Generate a social caption using OpenAI (DE), with fallback to make+model
exports.generateCaption = async (req, res) => {
  try {
    const { make, model, language } = req.body || {};
    const lang = (language || 'de').toLowerCase();
    const isDe = lang.startsWith('de');
    const prompt = isDe
      ? `Schreibe eine kurze, freundliche Bildunterschrift auf Deutsch für ein Auto-Angebot. Marke: ${make || ''}. Modell: ${model || ''}. Maximal 30 Wörter.`
      : `Write a short, friendly social caption in English for a car listing. Make: ${make || ''}. Model: ${model || ''}. Max 30 words.`;
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful marketing assistant for car dealerships.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 90,
      });
      const text = resp.choices?.[0]?.message?.content?.trim();
      return res.json({ caption: text || `${make || ''} ${model || ''}`.trim() });
    } catch (e) {
      return res.json({ caption: `${make || ''} ${model || ''}`.trim() });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to generate caption' });
  }
};

// Queue a social post job (fb/ig) for a specific mobile.de ad payload
exports.queueSocialPost = async (req, res) => {
  try {
    const { user, error: tokenError } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (tokenError || !user) return res.status(401).json({ error: 'Unauthorized: Invalid token' });

    const { platform, mobile_ad_id, images, caption, detail_url, make, model } = req.body || {};
    if (!platform || !['facebook', 'instagram'].includes(String(platform))) {
      return res.status(400).json({ error: 'Invalid platform' });
    }
    if (!mobile_ad_id) return res.status(400).json({ error: 'mobile_ad_id is required' });

    const payload = {
      images: Array.isArray(images) ? images.slice(0, 10) : [],
      caption: caption || null,
      detail_url: detail_url || null,
      make: make || null,
      model: model || null,
    };

    const { error } = await supabase
      .from('social_post_jobs')
      .insert({ user_id: user.id, platform: String(platform), mobile_ad_id: String(mobile_ad_id), payload });
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ queued: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to queue social post' });
  }
};

// Manually set a Facebook Marketing API access token for the current user (e.g., sandbox token)
exports.setFacebookToken = async (req, res) => {
  try {
    const { user, error: authErr } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { access_token, expires_at, metadata } = req.body || {};
    if (!access_token || typeof access_token !== 'string') {
      return res.status(400).json({ error: 'access_token is required (string)' });
    }

    const meta = Object.assign({ source: 'manual', environment: 'sandbox' }, metadata || {});

    await upsertFacebookUserToken(user.id, access_token, meta);

    // Optionally store expiry if your table supports it (handled in model if needed)
    return res.json({ saved: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to save token' });
  }
};

// List social posts by status with pagination
exports.listSocialPosts = async (req, res) => {
  try {
    const { user, error: tokenError } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (tokenError || !user) return res.status(401).json({ error: 'Unauthorized' });
    const status = (req.query.status || '').toString().toLowerCase();
    const allowed = ['queued', 'posting', 'success', 'failed'];
    const filter = allowed.includes(status) ? status : undefined;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

    let q = supabase
      .from('social_post_jobs')
      .select('id, platform, mobile_ad_id, payload, status, attempts, error, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (filter) q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to list posts' });
  }
};