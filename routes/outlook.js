const express = require('express');
const axios = require('axios');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt } = require('../utils/crypto');
const supabaseAdmin = require('../config/supabaseAdmin');

const router = express.Router();

// Get Outlook OAuth URL
router.get('/auth-url', async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });

    const clientId = process.env.OUTLOOK_CLIENT_ID;
    const redirectUri = `${process.env.BASE_DOMAIN || 'https://scriptiflow-server.onrender.com'}/api/outlook/callback`;
    const scope = 'https://graph.microsoft.com/calendars.readwrite offline_access';
    
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${clientId}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(scope)}&` +
      `response_mode=query&` +
      `state=${auth.user.id}`;

    res.json({ authUrl });
  } catch (error) {
    console.error('Outlook auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// Handle Outlook OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    
    if (!code || !userId) {
      return res.status(400).json({ error: 'Missing authorization code or user ID' });
    }

    // Exchange code for tokens
    const tokenResponse = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      client_id: process.env.OUTLOOK_CLIENT_ID,
      client_secret: process.env.OUTLOOK_CLIENT_SECRET,
      code: code,
      redirect_uri: `${process.env.BASE_DOMAIN || 'https://scriptiflow-server.onrender.com'}/api/outlook/callback`,
      grant_type: 'authorization_code',
      scope: 'https://graph.microsoft.com/calendars.readwrite offline_access'
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    
    // Encrypt tokens
    const accessEnc = encrypt(access_token);
    const refreshEnc = encrypt(refresh_token);
    const expiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

    // Store in database
    await supabaseAdmin.from('email_credentials').upsert({
      user_id: userId,
      provider: 'outlook',
      access_token_encrypted: accessEnc.encryptedData,
      access_token_iv: accessEnc.iv,
      refresh_token_encrypted: refreshEnc.encryptedData,
      refresh_token_iv: refreshEnc.iv,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,provider' });

    // Redirect to frontend with success
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/dashboard/calendar?outlook_connected=true`);
    
  } catch (error) {
    console.error('Outlook callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/dashboard/calendar?outlook_error=true`);
  }
});

// Disconnect Outlook
router.post('/disconnect', async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });

    await supabaseAdmin.from('email_credentials')
      .delete()
      .eq('user_id', auth.user.id)
      .eq('provider', 'outlook');

    res.json({ message: 'Outlook disconnected successfully' });
  } catch (error) {
    console.error('Outlook disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Outlook' });
  }
});

// Check Outlook connection status
router.get('/status', async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });

    const { data } = await supabaseAdmin
      .from('email_credentials')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('provider', 'outlook')
      .maybeSingle();

    res.json({ 
      connected: !!data,
      expires_at: data?.expires_at || null
    });
  } catch (error) {
    console.error('Outlook status error:', error);
    res.status(500).json({ error: 'Failed to check Outlook status' });
  }
});

module.exports = router;
