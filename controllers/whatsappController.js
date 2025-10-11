const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const axios = require('axios');
const { getFacebookUserToken } = require('../models/socialTokenModel');
const demo = require('../utils/whatsappDemoStore');
const WA = require('../utils/whatsappConfig');

function normalizePhone(phone) {
  return (phone || '').replace(/\D+/g, '');
}

function isCarRelated(text) {
  if (!text) return false;
  const hay = text.toLowerCase();
  const keywords = ['interested', 'price', 'vin', 'fahrgestell', 'modell', 'model', 'plate', 'kennzeichen'];
  return keywords.some(k => hay.includes(k));
}

async function findMatchingCar(userId, text) {
  if (!text) return null;
  try {
    const tokens = (text.match(/[a-z0-9-]{4,}/gi) || []).slice(0, 10);
    if (!tokens.length) return null;
    const { data } = await supabase
      .from('mobile_de_listings')
      .select('mobile_ad_id, details')
      .eq('user_id', userId)
      .limit(50);
    if (!Array.isArray(data)) return null;
    const lower = tokens.map(t => t.toLowerCase());
    for (const row of data) {
      const blob = JSON.stringify(row.details || '').toLowerCase();
      if (lower.some(t => blob.includes(t))) {
        return row.mobile_ad_id;
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

exports.connectWhatsApp = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { waba_phone_number_id, waba_business_account_id, access_token } = req.body || {};
    // DEMO: allow hardcoded token only mode (no DB), for quick connect button
    if (req.query?.demo === '1') {
      if (!access_token) return res.status(400).json({ error: 'access_token required for demo connect' });
      demo.setToken(access_token, waba_phone_number_id || 'YOUR_PHONE_NUMBER_ID');
      return res.json({ status: 'connected-demo' });
    }

    if (!waba_phone_number_id && !access_token) return res.status(400).json({ error: 'Provide phone_number_id or access_token' });

    // Store credentials encrypted at app level; you commented schema creation; assuming table exists or will be added later
    const record = {
      user_id: user.id,
      waba_phone_number_id,
      waba_business_account_id: waba_business_account_id || null,
      access_token_encrypted: access_token, // TODO: replace with encryption utility if desired
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from('whatsapp_credentials')
      .upsert({ ...record, deleted_at: null }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: 'Failed to save credentials', details: error.message });
    return res.json({ status: 'connected' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

exports.getCredentials = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    if (req.query?.demo === '1') {
      return res.json({ waba_phone_number_id: WA.PHONE_NUMBER_ID, connected_at: new Date().toISOString(), mode: 'hardcoded' });
    }

    const { data, error } = await supabase
      .from('whatsapp_credentials')
      .select('waba_phone_number_id, waba_business_account_id, connected_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Not connected' });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

// Auto-discover numbers via FB user token
exports.listPhoneNumbers = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;

    // get long-lived facebook user token
    const tokenRow = await getFacebookUserToken(user.id);
    const fbUserToken = tokenRow?.access_token;
    if (!fbUserToken) return res.status(400).json({ error: 'Facebook not connected' });

    // list WhatsApp business accounts (try standard edge first)
    let accounts = [];
    let wbaResp = await axios.get('https://graph.facebook.com/v19.0/me/whatsapp_business_accounts', {
      params: { access_token: fbUserToken, fields: 'id,name' },
      validateStatus: () => true,
    });
    if (wbaResp.status !== 200) {
      // Fallback older/alternative edge
      wbaResp = await axios.get('https://graph.facebook.com/v19.0/me/owned_whatsapp_business_accounts', {
        params: { access_token: fbUserToken, fields: 'id,name' },
        validateStatus: () => true,
      });
    }
    if (wbaResp.status !== 200) {
      return res.status(502).json({ error: 'Failed to list WABAs', status: wbaResp.status, details: wbaResp.data });
    }

    accounts = Array.isArray(wbaResp.data?.data) ? wbaResp.data.data : [];
    const allNumbers = [];
    for (const acc of accounts) {
      // Primary edge
      let nums = await axios.get(`https://graph.facebook.com/v19.0/${acc.id}/phone_numbers`, {
        params: { access_token: fbUserToken, fields: 'id,display_phone_number,verified_name' },
        validateStatus: () => true,
      });
      if (nums.status !== 200) {
        // Some accounts require business_phone_numbers edge
        nums = await axios.get(`https://graph.facebook.com/v19.0/${acc.id}/business_phone_numbers`, {
          params: { access_token: fbUserToken, fields: 'id,display_phone_number,verified_name' },
          validateStatus: () => true,
        });
      }
      if (nums.status === 200 && Array.isArray(nums.data?.data)) {
        for (const n of nums.data.data) {
          allNumbers.push({
            waba_business_account_id: acc.id,
            phone_number_id: n.id,
            display_phone_number: n.display_phone_number,
            verified_name: n.verified_name || null,
          });
        }
      }
    }
    return res.json(allNumbers);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to list phone numbers' });
  }
};

exports.disconnect = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { error } = await supabaseAdmin
      .from('whatsapp_credentials')
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ status: 'disconnected' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

exports.webhookVerify = async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WA.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

exports.webhookReceive = async (req, res) => {
  try {
    const body = req.body || {};
    const entry = Array.isArray(body.entry) ? body.entry[0] : null;
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages || [];
    const metadata = changes?.value?.metadata;
    if (!messages.length) return res.sendStatus(200);

    // DEMO: mirror inbound into memory inbox for screencast
    if (req.query?.demo === '1') {
      for (const msg of messages) {
        const text = msg.text?.body || '';
        demo.addMessage({ from: msg.from, to: 'me', body: text, direction: 'inbound' });
      }
      return res.sendStatus(200);
    }

    // Find dealership user by phone_number_id in credentials
    const phone_number_id = metadata?.phone_number_id;
    if (!phone_number_id) return res.sendStatus(200);
    const { data: cred } = await supabase
      .from('whatsapp_credentials')
      .select('user_id')
      .eq('waba_phone_number_id', phone_number_id)
      .maybeSingle();
    if (!cred?.user_id) return res.sendStatus(200);
    const userId = cred.user_id;

    for (const msg of messages) {
      const fromPhone = normalizePhone(msg.from);
      const text = msg.text?.body || msg.button?.text || '';
      const name = msg.profile?.name || null;

      // Upsert contact into universal crm_contacts
      const chatLink = `https://wa.me/${fromPhone}`;
      const firstName = name ? String(name).split(' ')[0] : null;
      const lastName = name && String(name).includes(' ') ? String(name).split(' ').slice(1).join(' ') : null;
      const { data: contactRow } = await supabaseAdmin
        .from('crm_contacts')
        .upsert({
          user_id: userId,
          first_name: firstName,
          last_name: lastName,
          phone: fromPhone,
          chat_link: chatLink,
          source: 'whatsapp'
        }, { onConflict: 'id' })
        .select('*')
        .maybeSingle();
      const contactId = contactRow?.id || contactRow?.[0]?.id;

      // Conversation (by user + contact)
      let conversationId = null;
      const { data: conv } = await supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('user_id', userId)
        .eq('contact_id', contactId)
        .maybeSingle();
      if (!conv) {
        const { data: created } = await supabaseAdmin
          .from('whatsapp_conversations')
          .insert({ user_id: userId, contact_id: contactId, last_message_at: new Date().toISOString(), unread_count: 1 })
          .select('id')
          .single();
        conversationId = created?.id;
      } else {
        conversationId = conv.id;
        await supabaseAdmin
          .from('whatsapp_conversations')
          .update({ last_message_at: new Date().toISOString(), unread_count: (conv.unread_count || 0) + 1 })
          .eq('id', conversationId);
      }

      // Car flagging
      const carRelated = isCarRelated(text);
      const matchedCar = carRelated ? await findMatchingCar(userId, text) : null;

      await supabaseAdmin
        .from('whatsapp_messages')
        .insert({
          user_id: userId,
          conversation_id: conversationId,
          direction: 'inbound',
          whatsapp_message_id: msg.id,
          body: text,
          is_car_related: !!carRelated,
          matched_car_mobile_de_id: matchedCar,
        });
    }

    return res.sendStatus(200);
  } catch (err) {
    return res.status(200).json({ status: 'ok' });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { conversation_id, message, to } = req.body || {};
    if (req.query?.demo === '1') {
      if (!to || !message) return res.status(400).json({ error: 'to and message required' });
      const url = `https://graph.facebook.com/v19.0/${WA.PHONE_NUMBER_ID}/messages`;
      await axios.post(url, { messaging_product: 'whatsapp', to, text: { body: message } }, { headers: { Authorization: `Bearer ${WA.ACCESS_TOKEN}` }, validateStatus: () => true });
      demo.addMessage({ from: 'me', to, body: message, direction: 'outbound' });
      return res.json({ sent: true });
    }

    const { data: c0 } = await supabase
      .from('whatsapp_conversations')
      .select('id')
      .eq('id', conversation_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!c0) return res.status(400).json({ error: 'conversation_id required' });

    // Get conversation and contact
    const { data: conv, error: cErr } = await supabase
      .from('whatsapp_conversations')
      .select('id, contact_id')
      .eq('id', conversation_id)
      .eq('user_id', user.id)
      .single();
    if (cErr || !conv) return res.status(404).json({ error: 'Conversation not found' });
    const { data: contact } = await supabase
      .from('crm_contacts')
      .select('phone')
      .eq('id', conv.contact_id)
      .single();
    const toPhone = contact?.phone;

    const { data: cred } = await supabase
      .from('whatsapp_credentials')
      .select('waba_phone_number_id, access_token_encrypted')
      .eq('user_id', user.id)
      .single();
    if (!cred) return res.status(400).json({ error: 'WhatsApp not connected' });

    // Choose access token: stored WhatsApp token or fallback to Facebook user token
    let bearer = cred.access_token_encrypted;
    if (!bearer || bearer === 'fb_token_managed') {
      const tokenRow = await getFacebookUserToken(user.id);
      bearer = tokenRow?.access_token;
    }
    if (!bearer) return res.status(400).json({ error: 'Missing access token. Connect via Facebook or provide a WhatsApp token.' });

    const url = `https://graph.facebook.com/v19.0/${cred.waba_phone_number_id}/messages`;
    await axios.post(url, {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'text',
      text: { body: message }
    }, {
      headers: { Authorization: `Bearer ${bearer}` },
      validateStatus: () => true,
    });

    await supabaseAdmin
      .from('whatsapp_messages')
      .insert({ user_id: user.id, conversation_id, direction: 'outbound', body: message });

    return res.json({ sent: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to send' });
  }
};

// DEMO inbox
exports.demoInbox = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const list = demo.listMessages();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

exports.listConversations = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('id, last_message_at, unread_count, tag, contact_id')
      .eq('user_id', user.id)
      .order('last_message_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // join contacts info
    const contactIds = (data || []).map(c => c.contact_id);
    const { data: contacts } = await supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email, phone, source')
      .in('id', contactIds);
    const byId = new Map((contacts || []).map(c => [c.id, c]));

    const result = (data || []).map(row => ({
      ...row,
      contact: byId.get(row.contact_id) || null,
    }));
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

exports.listMessages = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { conversation_id } = req.query;
    if (!conversation_id) return res.status(400).json({ error: 'conversation_id required' });
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, body, created_at, is_car_related, matched_car_mobile_de_id')
      .eq('user_id', user.id)
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

exports.markRead = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { conversation_id } = req.body || {};
    if (!conversation_id) return res.status(400).json({ error: 'conversation_id required' });
    const { error } = await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ unread_count: 0 })
      .eq('id', conversation_id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

exports.setTag = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const user = authRes.user;
    const { conversation_id, tag } = req.body || {};
    if (!conversation_id || !tag) return res.status(400).json({ error: 'conversation_id and tag required' });
    const allowed = ['Lead','Customer','Sold','Spam'];
    if (!allowed.includes(tag)) return res.status(400).json({ error: 'Invalid tag' });
    const { error } = await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ tag })
      .eq('id', conversation_id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};


