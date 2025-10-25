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
    if (auth.error)
      return res.status(auth.error.status || 401).json({ error: auth.error.message });

    const user = auth.user;
    const cal = await getAuthedCalendar(user.id);

    const now = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const future = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

    // Fetch from Google Calendar
    const { data } = await cal.events.list({
      calendarId: 'primary',
      timeMin: past,
      timeMax: future,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
    });

    // Upsert into local DB for faster retrieval
    const items = Array.isArray(data.items) ? data.items : [];

    for (const ev of items) {
      const start =
        ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
      const end =
        ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
      if (!start || !end) continue;

      // Try linking to a contact by attendee or email in description
      let contactId = null;
      let emailCandidate = null;
      let nameCandidate = null;

      if (Array.isArray(ev.attendees) && ev.attendees.length) {
        const att =
          ev.attendees.find((a) => a.email && a.responseStatus !== 'declined') ||
          ev.attendees[0];
        emailCandidate = att?.email || null;
        nameCandidate = att?.displayName || null;
      }

      if (!emailCandidate && typeof ev.description === 'string') {
        const m = ev.description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (m) emailCandidate = m[0];
      }

      if (emailCandidate) {
        try {
          contactId = await findOrCreateContact(user.id, {
            name: nameCandidate,
            email: emailCandidate,
          });
        } catch (_) {}
      }

      await supabaseAdmin.from('calendar_events').upsert(
        {
          user_id: user.id,
          google_event_id: ev.id,
          calendar_id: ev.organizer?.email || 'primary',
          title: ev.summary || 'Event',
          description: ev.description || null,
          location: ev.location || null,
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
          contact_id: contactId || null,
        },
        { onConflict: 'user_id,google_event_id' }
      );
    }

    // 🧠 Apply filters if start_time and end_time are provided in query
    const { start_time: queryStart, end_time: queryEnd } = req.query;

    let rowsQuery = supabase
      .from('calendar_events')
      .select(
        'id, google_event_id, title, description, location, start_time, end_time, car_mobile_de_id, contact_id'
      )
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('start_time', { ascending: true });

    // ✅ Filter by overlapping range
    if (queryStart && queryEnd) {
      rowsQuery = rowsQuery
        .lte('start_time', queryEnd) // event starts before or during the end of range
        .gte('end_time', queryStart); // event ends after or during the start of range
    }

    const { data: rows, error } = await rowsQuery;

    if (error) throw new Error(error.message);

    return res.json(rows || []);
  } catch (e) {
    console.error('Error listing events:', e);
    return res
      .status(500)
      .json({ error: e.message || 'Failed to list events' });
  }
};


async function findOrCreateContact(userId, { name, email }) {
  if (!email && !name) return null;
  let contact = null;
  if (email) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('id, first_name, last_name, email')
      .eq('user_id', userId)
      .eq('email', email)
      .maybeSingle();
    if (data) contact = data;
  }
  if (!contact) {
    let firstName = null; let lastName = null;
    if (name) {
      const parts = String(name).trim().split(/\s+/);
      firstName = parts[0] || null; lastName = parts.slice(1).join(' ') || null;
    }
    const { data: created } = await supabaseAdmin
      .from('crm_contacts')
      .insert({ user_id: userId, first_name: firstName, last_name: lastName, email, source: 'calendar' })
      .select('id')
      .single();
    return created?.id || null;
  }
  return contact.id;
}

exports.createEvent = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    const { title, description, location, start_time, end_time, car_mobile_de_id, contact_id, customer_name, customer_email } = req.body || {};
    if (!title || !start_time || !end_time) return res.status(400).json({ error: 'title, start_time, end_time required' });
    const cal = await getAuthedCalendar(user.id);
    const requestBody = { summary: title, description, location, start: { dateTime: start_time }, end: { dateTime: end_time } };
    if (customer_email) {
      requestBody.attendees = [{ email: customer_email, displayName: customer_name || undefined }];
    }
    const g = await cal.events.insert({ calendarId: 'primary', requestBody });
    const google_event_id = g.data.id;
    let finalContactId = contact_id || null;
    if (!finalContactId && (customer_email || customer_name)) {
      finalContactId = await findOrCreateContact(user.id, { name: customer_name || null, email: customer_email || null });
    }
    const { data: created, error } = await supabaseAdmin.from('calendar_events').insert({ user_id: user.id, google_event_id, calendar_id: 'primary', title, description, location, start_time, end_time, car_mobile_de_id: car_mobile_de_id || null, contact_id: finalContactId || null }).select('id').single();
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
    const { title, description, location, start_time, end_time, car_mobile_de_id, contact_id, customer_name, customer_email } = req.body || {};
    const { data: row } = await supabase.from('calendar_events').select('google_event_id').eq('user_id', user.id).eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'Event not found' });
    const cal = await getAuthedCalendar(user.id);
    const requestBody = { summary: title, description, location, start: { dateTime: start_time }, end: { dateTime: end_time } };
    if (customer_email) {
      requestBody.attendees = [{ email: customer_email, displayName: customer_name || undefined }];
    }
    await cal.events.patch({ calendarId: 'primary', eventId: row.google_event_id, requestBody });
    let finalContactId = contact_id || null;
    if (!finalContactId && (customer_email || customer_name)) {
      finalContactId = await findOrCreateContact(user.id, { name: customer_name || null, email: customer_email || null });
    }
    const { error } = await supabaseAdmin.from('calendar_events').update({ title, description, location, start_time, end_time, car_mobile_de_id: car_mobile_de_id || null, contact_id: finalContactId || null, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
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


