const axios = require('axios');
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt, decrypt } = require('../utils/crypto');

require('dotenv').config();

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'scriptiflow-server.onrender.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Google OAuth config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = `https://${BASE_DOMAIN}/api/email/gmail/callback`;
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
  'profile',
];

// Microsoft OAuth config
const MS_CLIENT_ID = process.env.MS_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || '';
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || '';
const MS_TENANT = process.env.MS_TENANT || 'common';
const MS_REDIRECT_URI = `https://${BASE_DOMAIN}/api/email/outlook/callback`;
const OUTLOOK_SCOPES = [
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
].join(' ');

function base64UrlEncode(input) {
  const buff = Buffer.from(input, 'utf8');
  return buff.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function htmlToText(html) {
  if (!html) return '';
  try {
    return String(html)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (_) {
    return String(html || '');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeGmailBody(data) {
  return data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
}

const MARKETPLACE_DOMAINS = ['mobile.de', 'autoscout24', 'autoscout24.de', 'kleinanzeigen.de', 'ebay-kleinanzeigen.de', 'carwow', 'heycar', 'autohero', 'wirkaufendeinauto'];
const CAR_MAKES = [
  'audi','bmw','mercedes','mercedes-benz','vw','volkswagen','porsche','opel','ford','skoda','seat','renault','peugeot','citroen','dacia','fiat','alfa romeo','toyota','lexus','nissan','mazda','honda','hyundai','kia','volvo','mini','jaguar','land rover','tesla','cupra','ssangyong','suzuki','subaru','mitsubishi'
];
const SUBJECT_KEYWORDS = ['anfrage','fahrzeug','auto','probefahrt','test drive','angebot','inquiry','vehicle','vin','fahrgestell'];
const BODY_KEYWORDS = ['fahrzeug','modell','modelljahr','baujahr','vin','fahrgestell','probefahrt','anfrage','angebot','ez','kilometer','km','ps','kw','preis','price'];

function detectSource({ from, body, listingLink }) {
  const hayFrom = (from || '').toLowerCase();
  const hayBody = (body || '').toLowerCase();
  const link = (listingLink || '').toLowerCase();
  const hay = hayFrom + ' ' + hayBody + ' ' + link;
  if (hay.includes('mobile.de')) return 'mobilede';
  if (hay.includes('autoscout24')) return 'autoscout24';
  if (hay.includes('kleinanzeigen')) return 'kleinanzeigen';
  if (hay.includes('carwow')) return 'carwow';
  return null;
}

function findListingLink(text) {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[\w.-]+\.[\w.-]+[^\s)\]]+/);
  if (!m) return null;
  const url = m[0];
  // Prefer known marketplaces
  for (const d of MARKETPLACE_DOMAINS) {
    if (url.toLowerCase().includes(d)) return url;
  }
  return url;
}

function scoreCarLead({ from, subject, body }) {
  let score = 0;
  const reasons = [];
  const sender = (from || '').toLowerCase();
  const subj = (subject || '').toLowerCase();
  const text = (body || '').toLowerCase();

  if (MARKETPLACE_DOMAINS.some((d) => sender.includes(d))) { score += 5; reasons.push('marketplace-domain'); }
  const subjHits = SUBJECT_KEYWORDS.filter((w) => subj.includes(w)).length;
  if (subjHits) { score += 2 * subjHits; reasons.push('subject-keywords'); }
  const bodyHits = BODY_KEYWORDS.filter((w) => text.includes(w)).length;
  if (bodyHits) { score += 1 * Math.min(bodyHits, 5); reasons.push('body-keywords'); }

  // VIN pattern
  if (/[A-HJ-NPR-Z0-9]{17}/i.test(text)) { score += 4; reasons.push('vin'); }
  // Year/Baujahr
  if (/(baujahr|year|ez)\s*[:\-]?\s*(19|20)\d{2}/i.test(text)) { score += 2; reasons.push('year'); }
  // Make mentioned
  if (CAR_MAKES.some((m) => text.includes(m))) { score += 2; reasons.push('make'); }
  // Price-like
  if (/(preis|price)\s*[:\-]?\s*[\d\.,]{3,}\s*(€|eur)?/i.test(text)) { score += 2; reasons.push('price'); }
  // Probefahrt/Test Drive
  if (/(probefahrt|test drive)/i.test(text)) { score += 2; reasons.push('testdrive'); }

  // Negative signals
  if (/(newsletter|rechnung|invoice|receipt|newsletter)/i.test(text) || /(no-?reply)/i.test(sender)) { score -= 3; reasons.push('negative'); }

  const threshold = 5;
  return { isLead: score >= threshold, score, reasons };
}

function isCarRelatedEmail({ from, subject, body }) {
  const { isLead } = scoreCarLead({ from, subject, body });
  return isLead;
}

function parseLeadFromEmail({ body, subject, from }) {
  const result = {
    customer_name: null,
    email: null,
    phone: null,
    car_model: null,
    car_year: null,
    car_price: null,
    listing_link: null,
  };
  const text = `${subject || ''}\n${body || ''}`;
  // email
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  result.email = emailMatch ? emailMatch[0] : (from && /<(.*?)>/.test(from) ? (from.match(/<(.*?)>/) || [null, null])[1] : null);
  // phone
  const phoneMatch = text.match(/(?:\+\d{1,3}[\s-]?)?(?:\(\d{1,4}\)[\s-]?)?\d{3,}(?:[\s-]?\d{2,}){1,}/);
  result.phone = phoneMatch ? phoneMatch[0].replace(/\s+/g, ' ').trim() : null;
  // name
  const nameFromHeader = from && /"([^"]+)"/.test(from) ? (from.match(/"([^"]+)"/) || [null, null])[1] : null;
  const nameMatch = text.match(/(?:Name|Kontakt|Customer|Kunde)\s*[:\-]\s*([A-Za-zÄÖÜäöüß\-\s]{3,60})/i);
  const name = (nameMatch && nameMatch[1]) || nameFromHeader || null;
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      result.customer_name = name.trim();
    } else {
      result.customer_name = name.trim();
    }
  }
  // car details
  const modelMatch = text.match(/(?:Model|Modell|Fahrzeug)\s*[:\-]\s*([\w\-\s]{2,60})/i);
  if (modelMatch) result.car_model = modelMatch[1].trim();
  const yearMatch = text.match(/(?:Year|Baujahr|EZ)\s*[:\-]\s*(\d{4})/i);
  if (yearMatch) result.car_year = yearMatch[1];
  const priceMatch = text.match(/(?:Price|Preis)\s*[:\-]\s*([\d,.]+)\s*(?:EUR|€)?/i);
  if (priceMatch) result.car_price = priceMatch[1].replace(/[,]/g, '.');
  const link = findListingLink(text);
  if (link) result.listing_link = link;
  return result;
}

async function upsertContactForUser({ userId, parsed, source }) {
  const email = parsed.email || null;
  const phone = parsed.phone ? parsed.phone.replace(/\D+/g, '') : null;
  let firstName = null;
  let lastName = null;
  if (parsed.customer_name) {
    const parts = parsed.customer_name.trim().split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(' ') || null;
  }
  // Try to find existing by email or phone
  let contact = null;
  if (email) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('email', email)
      .maybeSingle();
    if (data) contact = data;
  }
  if (!contact && phone) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('phone', phone)
      .maybeSingle();
    if (data) contact = data;
  }
  if (!contact) {
    const { data: created } = await supabaseAdmin
      .from('crm_contacts')
      .insert({ user_id: userId, first_name: firstName, last_name: lastName, email, phone, source })
      .select('*')
      .single();
    return created;
  } else {
    const update = { first_name: contact.first_name || firstName, last_name: contact.last_name || lastName };
    if (!contact.email && email) update.email = email;
    if (!contact.phone && phone) update.phone = phone;
    const { data: updated } = await supabaseAdmin
      .from('crm_contacts')
      .update(update)
      .eq('id', contact.id)
      .select('*')
      .single();
    return updated;
  }
}

async function saveLead({ userId, provider, threadId, messageId, from, subject, snippet, body, receivedAt }) {
  const carRelated = isCarRelatedEmail({ from, subject, body });
  const parsed = parseLeadFromEmail({ body, subject, from });
  const contact = await upsertContactForUser({ userId, parsed, source: provider });
  const payload = {
    user_id: userId,
    provider,
    thread_id: threadId,
    message_id: messageId,
    from_email: parsed.email || null,
    from_name: parsed.customer_name || null,
    subject: subject || null,
    snippet: snippet || (body ? String(body).slice(0, 200) : null),
    body,
    received_at: receivedAt || new Date().toISOString(),
    is_car_related: carRelated,
    customer_name: parsed.customer_name,
    customer_email: parsed.email,
    customer_phone: parsed.phone,
    car_model: parsed.car_model,
    car_year: parsed.car_year,
    car_price: parsed.car_price,
    listing_link: parsed.listing_link,
    contact_id: contact?.id || null,
  };
  await supabaseAdmin.from('email_leads').upsert(payload, { onConflict: 'user_id,message_id' });
  return payload;
}

async function getEmailCredentials(userId) {
  const { data } = await supabase
    .from('email_credentials')
    .select('*')
    .eq('user_id', userId);
  return Array.isArray(data) ? data : [];
}

async function getGmailBearer(userId) {
  const { data } = await supabase
    .from('email_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .maybeSingle();
  if (!data) return null;
  let accessToken = data.access_token_encrypted ? decrypt(data.access_token_encrypted, data.access_token_iv) : null;
  const refreshToken = data.refresh_token_encrypted ? decrypt(data.refresh_token_encrypted, data.refresh_token_iv) : null;
  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const now = Date.now() + 60 * 1000; // 1 min buffer
  if (!accessToken || !expiresAt || expiresAt < now) {
    if (!refreshToken) return null;
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    accessToken = tokenRes.data.access_token;
    const expiresIn = tokenRes.data.expires_in || 3600;
    const enc = encrypt(accessToken);
    await supabaseAdmin
      .from('email_credentials')
      .update({ access_token_encrypted: enc.encryptedData, access_token_iv: enc.iv, expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', data.id);
  }
  return accessToken;
}

async function getOutlookBearer(userId) {
  const { data } = await supabase
    .from('email_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .maybeSingle();
  if (!data) return null;
  let accessToken = data.access_token_encrypted ? decrypt(data.access_token_encrypted, data.access_token_iv) : null;
  const refreshToken = data.refresh_token_encrypted ? decrypt(data.refresh_token_encrypted, data.refresh_token_iv) : null;
  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const now = Date.now() + 60 * 1000;
  if (!accessToken || !expiresAt || expiresAt < now) {
    if (!refreshToken) return null;
    const tokenRes = await axios.post(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, new URLSearchParams({
      client_id: MS_CLIENT_ID,
      scope: OUTLOOK_SCOPES,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_secret: MS_CLIENT_SECRET,
      redirect_uri: MS_REDIRECT_URI,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    accessToken = tokenRes.data.access_token;
    const expiresIn = tokenRes.data.expires_in || 3600;
    const enc = encrypt(accessToken);
    await supabaseAdmin
      .from('email_credentials')
      .update({ access_token_encrypted: enc.encryptedData, access_token_iv: enc.iv, expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', data.id);
  }
  return accessToken;
}

exports.getGmailLoginUrl = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const state = encodeURIComponent(JSON.stringify({ user_id: user.id, ts: Date.now() }));
    const url = 'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(GMAIL_SCOPES.join(' '))}` +
      `&access_type=offline&prompt=consent&include_granted_scopes=true` +
      `&state=${state}`;
    return res.json({ auth_url: url });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to build Gmail login URL' });
  }
};

exports.gmailCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${FRONTEND_URL}/connect?status=error&message=${encodeURIComponent(String(error))}`);
    let user_id = null;
    try { user_id = JSON.parse(decodeURIComponent(state || ''))?.user_id || null; } catch (_) {}
    if (!code || !user_id) return res.redirect(`${FRONTEND_URL}/connect?status=error&message=${encodeURIComponent('Invalid OAuth response')}`);

    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const accessToken = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token; // may be undefined if already granted; require prompt=consent ensures it
    const expiresIn = tokenRes.data.expires_in || 3600;

    // Get user email address via Gmail profile
    let accountEmail = null;
    try {
      const prof = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${accessToken}` } });
      accountEmail = prof.data?.emailAddress || null;
    } catch (_) {}

    const accEnc = encrypt(accessToken);
    const refEnc = refreshToken ? encrypt(refreshToken) : { encryptedData: null, iv: null };
    const record = {
      user_id: user_id,
      provider: 'gmail',
      account_email: accountEmail,
      access_token_encrypted: accEnc.encryptedData,
      access_token_iv: accEnc.iv,
      refresh_token_encrypted: refEnc.encryptedData,
      refresh_token_iv: refEnc.iv,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await supabaseAdmin.from('email_credentials').upsert(record, { onConflict: 'user_id,provider' });
    return res.redirect(`${FRONTEND_URL}/connect?status=success`);
  } catch (e) {
    return res.redirect(`${FRONTEND_URL}/connect?status=error&message=${encodeURIComponent('Failed to connect Gmail')}`);
  }
};

exports.getOutlookLoginUrl = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const state = encodeURIComponent(JSON.stringify({ user_id: user.id, ts: Date.now() }));
    const url = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(MS_CLIENT_ID)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(MS_REDIRECT_URI)}` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(OUTLOOK_SCOPES)}` +
      `&state=${state}`;
    return res.json({ auth_url: url });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to build Outlook login URL' });
  }
};

exports.outlookCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${FRONTEND_URL}/connect?status=error&message=${encodeURIComponent(String(error))}`);
    let user_id = null;
    try { user_id = JSON.parse(decodeURIComponent(state || ''))?.user_id || null; } catch (_) {}
    if (!code || !user_id) return res.redirect(`${FRONTEND_URL}/connect?status=error&message=${encodeURIComponent('Invalid OAuth response')}`);

    const tokenRes = await axios.post(`https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, new URLSearchParams({
      client_id: MS_CLIENT_ID,
      scope: OUTLOOK_SCOPES,
      code,
      redirect_uri: MS_REDIRECT_URI,
      grant_type: 'authorization_code',
      client_secret: MS_CLIENT_SECRET,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const accessToken = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token;
    const expiresIn = tokenRes.data.expires_in || 3600;

    // Get user principal email
    let accountEmail = null;
    try {
      const me = await axios.get('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${accessToken}` } });
      accountEmail = me.data?.mail || me.data?.userPrincipalName || null;
    } catch (_) {}

    const accEnc = encrypt(accessToken);
    const refEnc = refreshToken ? encrypt(refreshToken) : { encryptedData: null, iv: null };
    const record = {
      user_id: user_id,
      provider: 'outlook',
      account_email: accountEmail,
      access_token_encrypted: accEnc.encryptedData,
      access_token_iv: accEnc.iv,
      refresh_token_encrypted: refEnc.encryptedData,
      refresh_token_iv: refEnc.iv,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await supabaseAdmin.from('email_credentials').upsert(record, { onConflict: 'user_id,provider' });
    return res.redirect(`${FRONTEND_URL}/connect?status=success`);
  } catch (e) {
    return res.redirect(`${FRONTEND_URL}/connect?status=error&message=${encodeURIComponent('Failed to connect Outlook')}`);
  }
};

exports.getStatus = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const creds = await getEmailCredentials(user.id);
    const gmail = creds.find((c) => c.provider === 'gmail') || null;
    const outlook = creds.find((c) => c.provider === 'outlook') || null;
    return res.json({
      gmail: gmail ? { connected: true, account_email: gmail.account_email } : { connected: false },
      outlook: outlook ? { connected: true, account_email: outlook.account_email } : { connected: false },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to load status' });
  }
};

exports.disconnect = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const provider = (req.query.provider || '').toLowerCase();
    if (!['gmail', 'outlook'].includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    const { error } = await supabaseAdmin
      .from('email_credentials')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', provider);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ disconnected: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to disconnect' });
  }
};

exports.listLeads = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { data, error } = await supabase
      .from('email_leads')
      .select('id, provider, from_email, from_name, subject, snippet, body, received_at, customer_name, car_model, car_year, car_price, listing_link, thread_id, message_id')
      .eq('user_id', user.id)
      .order('received_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to list leads' });
  }
};

exports.reply = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { lead_id, message } = req.body || {};
    if (!lead_id || !message) return res.status(400).json({ error: 'lead_id and message required' });
    const { data: lead, error } = await supabase
      .from('email_leads')
      .select('*')
      .eq('user_id', user.id)
      .eq('id', lead_id)
      .maybeSingle();
    if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

    if (lead.provider === 'gmail') {
      const bearer = await getGmailBearer(user.id);
      if (!bearer) return res.status(400).json({ error: 'Gmail not connected' });
      const raw =
        `To: ${lead.from_email}\r\n` +
        `Subject: Re: ${lead.subject || ''}\r\n` +
        (lead.thread_id ? `In-Reply-To: ${lead.message_id}\r\nReferences: ${lead.message_id}\r\n` : '') +
        `\r\n` +
        `${message}`;
      const rawEncoded = base64UrlEncode(raw);
      const payload = { raw: rawEncoded };
      if (lead.thread_id) payload.threadId = lead.thread_id;
      await axios.post('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', payload, {
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      });
    } else if (lead.provider === 'outlook') {
      const bearer = await getOutlookBearer(user.id);
      if (!bearer) return res.status(400).json({ error: 'Outlook not connected' });
      // Use reply action with comment
      await axios.post(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(lead.message_id)}/reply`, {
        comment: message,
      }, { headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' } });
    } else {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    return res.json({ sent: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to send reply' });
  }
};

exports.fetchNow = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const result = await fetchEmailsForUser(user.id);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to fetch emails' });
  }
};

async function fetchGmail(userId) {
  const bearer = await getGmailBearer(userId);
  if (!bearer) return { processed: 0 };
  let processed = 0;
  // fetch recent messages (last 14 days)
  const query = 'newer_than:14d';
  const list = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
    headers: { Authorization: `Bearer ${bearer}` },
    params: { q: query, maxResults: 25 },
  });
  const messages = Array.isArray(list.data?.messages) ? list.data.messages : [];
  for (const m of messages) {
    try {
      const msg = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}`, {
        headers: { Authorization: `Bearer ${bearer}` },
        params: { format: 'full' },
      });
      const headers = msg.data?.payload?.headers || [];
      const getH = (name) => (headers.find((h) => h.name?.toLowerCase() === name) || {}).value || '';
      const from = getH('from');
      const subject = getH('subject');
      const date = getH('date');
      // Prefer HTML body when available
      function extractHtml(part) {
        if (!part) return '';
        if (part.parts && part.parts.length) return part.parts.map(extractHtml).join('');
        const data = decodeGmailBody(part.body?.data || '');
        if ((part.mimeType || '').includes('text/html')) return data;
        if ((part.mimeType || '').includes('text/plain')) return `<pre>${escapeHtml(data)}</pre>`;
        return '';
      }
      function extractText(part) {
        if (!part) return '';
        if (part.parts && part.parts.length) return part.parts.map(extractText).join('\n');
        const data = decodeGmailBody(part.body?.data || '');
        if ((part.mimeType || '').includes('text/html')) return htmlToText(data);
        return data || '';
      }
      const bodyHtml = extractHtml(msg.data?.payload) || (extractText(msg.data?.payload) ? `<pre>${escapeHtml(extractText(msg.data?.payload))}</pre>` : '');
      const bodyText = extractText(msg.data?.payload) || msg.data?.snippet || '';
      const snippet = msg.data?.snippet || (body ? body.slice(0, 180) : '');
      if (isCarRelatedEmail({ from, subject, body: bodyText })) {
        await saveLead({
          userId,
          provider: 'gmail',
          threadId: msg.data?.threadId || null,
          messageId: msg.data?.id,
          from,
          subject,
          snippet,
          body: bodyHtml || bodyText,
          receivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
        });
        processed += 1;
      }
    } catch (_) {}
  }
  return { processed };
}

async function fetchOutlook(userId) {
  const bearer = await getOutlookBearer(userId);
  if (!bearer) return { processed: 0 };
  let processed = 0;
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const url = 'https://graph.microsoft.com/v1.0/me/messages';
  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${bearer}` },
    params: {
      $select: 'id,subject,receivedDateTime,conversationId,from,bodyPreview,body',
      $orderby: 'receivedDateTime desc',
      $top: 25,
      $filter: `receivedDateTime ge ${since}`,
    },
  });
  const items = Array.isArray(resp.data?.value) ? resp.data.value : [];
  for (const it of items) {
    try {
      const fromEmail = it.from?.emailAddress?.address || '';
      const fromName = it.from?.emailAddress?.name || '';
      const subject = it.subject || '';
      const bodyHtml = it.body?.content || '';
      const bodyText = htmlToText(bodyHtml) || it.bodyPreview || '';
      if (isCarRelatedEmail({ from: fromEmail, subject, body: bodyText })) {
        await saveLead({
          userId,
          provider: 'outlook',
          threadId: it.conversationId || null,
          messageId: it.id,
          from: `${fromName} <${fromEmail}>`,
          subject,
          snippet: (it.bodyPreview || '').slice(0, 200),
          body: bodyHtml || bodyText,
          receivedAt: it.receivedDateTime || new Date().toISOString(),
        });
        processed += 1;
      }
    } catch (_) {}
  }
  return { processed };
}

async function fetchEmailsForUser(userId) {
  const results = await Promise.allSettled([fetchGmail(userId), fetchOutlook(userId)]);
  let processed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') processed += r.value.processed || 0;
  }
  return { processed };
}

exports.fetchEmailsForUser = fetchEmailsForUser;


