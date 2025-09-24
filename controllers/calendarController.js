const { google } = require('googleapis');
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt, decrypt } = require('../utils/crypto');

async function getGmailTokens(userId) {
  const { data } = await supabase
    .from('email_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .maybeSingle();
  if (!data) return null;
  const access_token = data.access_token_encrypted ? decrypt(data.access_token_encrypted, data.access_token_iv) : null;
  const refresh_token = data.refresh_token_encrypted ? decrypt(data.refresh_token_encrypted, data.refresh_token_iv) : null;
  return { access_token, refresh_token, expires_at: data.expires_at, row: data };
}

function getOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `https://${process.env.BASE_DOMAIN || 'scriptiflow-server.onrender.com'}`
  );
  return client;
}

async function getAuthedCalendar(userId) {
  const tokens = await getGmailTokens(userId);
  if (!tokens) throw new Error('Gmail not connected');
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
  // handle refresh
  oauth2Client.on('tokens', async (t) => {
    if (t.access_token) {
      const enc = encrypt(t.access_token);
      await supabaseAdmin.from('email_credentials').update({ access_token_encrypted: enc.encryptedData, access_token_iv: enc.iv, expires_at: new Date(Date.now() + (t.expiry_date ? 0 : 3600 * 1000)).toISOString(), updated_at: new Date().toISOString() }).eq('id', tokens.row.id);
    }
    if (t.refresh_token) {
      const enc = encrypt(t.refresh_token);
      await supabaseAdmin.from('email_credentials').update({ refresh_token_encrypted: enc.encryptedData, refresh_token_iv: enc.iv, updated_at: new Date().toISOString() }).eq('id', tokens.row.id);
    }
  });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

exports.listEvents = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const cal = await getAuthedCalendar(user.id);
    const now = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const future = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
    const { data } = await cal.events.list({ calendarId: 'primary', timeMin: past, timeMax: future, singleEvents: true, orderBy: 'startTime', maxResults: 2500 });

    // upsert into local DB for quick retrieval
    const items = Array.isArray(data.items) ? data.items : [];
    for (const ev of items) {
      const start = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
      const end = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
      if (!start || !end) continue;
      await supabaseAdmin.from('calendar_events').upsert({
        user_id: user.id,
        google_event_id: ev.id,
        calendar_id: ev.organizer?.email || 'primary',
        title: ev.summary || 'Event',
        description: ev.description || null,
        location: ev.location || null,
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
      }, { onConflict: 'user_id,google_event_id' });
    }

    const { data: rows } = await supabase
      .from('calendar_events')
      .select('id, google_event_id, title, description, location, start_time, end_time, car_mobile_de_id, contact_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('start_time', { ascending: true });

    return res.json(rows || []);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to list events' });
  }
};

exports.createEvent = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { title, description, location, start_time, end_time, car_mobile_de_id, contact_id } = req.body || {};
    if (!title || !start_time || !end_time) return res.status(400).json({ error: 'title, start_time, end_time required' });
    const cal = await getAuthedCalendar(user.id);
    const g = await cal.events.insert({ calendarId: 'primary', requestBody: { summary: title, description, location, start: { dateTime: start_time }, end: { dateTime: end_time } } });
    const google_event_id = g.data.id;
    const { data: created, error } = await supabaseAdmin.from('calendar_events').insert({ user_id: user.id, google_event_id, calendar_id: 'primary', title, description, location, start_time, end_time, car_mobile_de_id: car_mobile_de_id || null, contact_id: contact_id || null }).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ id: created.id, google_event_id });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to create event' });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { id } = req.params;
    const { title, description, location, start_time, end_time, car_mobile_de_id, contact_id } = req.body || {};
    const { data: row } = await supabase.from('calendar_events').select('google_event_id').eq('user_id', user.id).eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'Event not found' });
    const cal = await getAuthedCalendar(user.id);
    await cal.events.patch({ calendarId: 'primary', eventId: row.google_event_id, requestBody: { summary: title, description, location, start: { dateTime: start_time }, end: { dateTime: end_time } } });
    const { error } = await supabaseAdmin.from('calendar_events').update({ title, description, location, start_time, end_time, car_mobile_de_id: car_mobile_de_id || null, contact_id: contact_id || null, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to update event' });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { id } = req.params;
    const { data: row } = await supabase.from('calendar_events').select('google_event_id').eq('user_id', user.id).eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'Event not found' });
    const cal = await getAuthedCalendar(user.id);
    await cal.events.delete({ calendarId: 'primary', eventId: row.google_event_id });
    const { error } = await supabaseAdmin.from('calendar_events').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to delete event' });
  }
};


