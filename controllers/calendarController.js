const { google } = require('googleapis');
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const { encrypt, decrypt } = require('../utils/crypto');
const axios = require('axios');

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
  if (!tokens) {
    throw new Error('Gmail not connected. Please connect your Gmail account first to use calendar features.');
  }
  
  // Check if Google OAuth credentials are configured
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
  }
  
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

// Outlook Calendar functions
async function getOutlookTokens(userId) {
  const { data } = await supabase
    .from('email_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .maybeSingle();
  if (!data) return null;
  const access_token = data.access_token_encrypted ? decrypt(data.access_token_encrypted, data.access_token_iv) : null;
  const refresh_token = data.refresh_token_encrypted ? decrypt(data.refresh_token_encrypted, data.refresh_token_iv) : null;
  return { access_token, refresh_token, expires_at: data.expires_at, row: data };
}

async function getAuthedOutlookCalendar(userId) {
  const tokens = await getOutlookTokens(userId);
  if (!tokens) {
    throw new Error('Outlook not connected. Please connect your Outlook account first to use calendar features.');
  }
  
  // Check if Outlook OAuth credentials are configured
  if (!process.env.OUTLOOK_CLIENT_ID || !process.env.OUTLOOK_CLIENT_SECRET) {
    throw new Error('Outlook OAuth credentials not configured. Please set OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET environment variables.');
  }
  
  // Refresh token if needed
  if (tokens.expires_at && new Date(tokens.expires_at) <= new Date()) {
    try {
      const refreshResponse = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        client_id: process.env.OUTLOOK_CLIENT_ID,
        client_secret: process.env.OUTLOOK_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/calendars.readwrite'
      });
      
      const enc = encrypt(refreshResponse.data.access_token);
      const refreshEnc = encrypt(refreshResponse.data.refresh_token);
      const expiresAt = new Date(Date.now() + (refreshResponse.data.expires_in * 1000)).toISOString();
      
      await supabaseAdmin.from('email_credentials').update({
        access_token_encrypted: enc.encryptedData,
        access_token_iv: enc.iv,
        refresh_token_encrypted: refreshEnc.encryptedData,
        refresh_token_iv: refreshEnc.iv,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      }).eq('id', tokens.row.id);
      
      tokens.access_token = refreshResponse.data.access_token;
    } catch (error) {
      console.error('Outlook token refresh failed:', error);
      throw new Error('Failed to refresh Outlook tokens');
    }
  }
  
  return {
    accessToken: tokens.access_token,
    baseURL: 'https://graph.microsoft.com/v1.0/me/calendars'
  };
}

function getSyncMessage(googleEventId, outlookEventId) {
  const google = !!googleEventId;
  const outlook = !!outlookEventId;
  
  if (google && outlook) {
    return '✅ Event synced to Google Calendar, Outlook Calendar, and local database';
  } else if (google) {
    return '✅ Event synced to Google Calendar and local database';
  } else if (outlook) {
    return '✅ Event synced to Outlook Calendar and local database';
  } else {
    return '✅ Event created in local database only';
  }
}

exports.listEvents = async (req, res) => {
  try {
    const auth = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (auth.error)
      return res.status(auth.error.status || 401).json({ error: auth.error.message });

    const user = auth.user;

    const now = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const future = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();

    // -------------------- 🗓️ SYNC WITH CALENDARS --------------------
    const syncPromises = [];

    // ✅ Google Calendar Sync
    syncPromises.push(
      (async () => {
        try {
          const cal = await getAuthedCalendar(user.id);
          const { data } = await cal.events.list({
            calendarId: 'primary',
            timeMin: past,
            timeMax: future,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
          });

          const items = Array.isArray(data.items) ? data.items : [];
          for (const ev of items) {
            const start = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
            const end = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
            if (!start || !end) continue;

            // Try linking to contact
            let contactId = null;
            let email = ev.attendees?.[0]?.email || null;
            let name = ev.attendees?.[0]?.displayName || null;

            if (!email && typeof ev.description === 'string') {
              const m = ev.description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
              if (m) email = m[0];
            }

            if (email) {
              try {
                contactId = await findOrCreateContact(user.id, { name, email });
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
                contact_id: contactId,
              },
              { onConflict: 'user_id,google_event_id' }
            );
          }
        } catch (err) {
          console.log('❌ Google Calendar sync failed:', err.message);
        }
      })()
    );

    // ✅ Outlook Calendar Sync
    syncPromises.push(
      (async () => {
        try {
          const outlookTokens = await getOutlookTokens(user.id);
          if (!outlookTokens) return;

          const outlook = await getAuthedOutlookCalendar(user.id);
          const response = await axios.get(
            `https://graph.microsoft.com/v1.0/me/events?$filter=start/dateTime ge '${past}' and end/dateTime le '${future}'&$orderby=start/dateTime&$top=2500`,
            {
              headers: {
                Authorization: `Bearer ${outlook.accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );

          const events = Array.isArray(response.data.value) ? response.data.value : [];
          for (const ev of events) {
            const start = ev.start?.dateTime;
            const end = ev.end?.dateTime;
            if (!start || !end) continue;

            let contactId = null;
            const attendee = ev.attendees?.[0];
            if (attendee?.emailAddress?.address) {
              try {
                contactId = await findOrCreateContact(user.id, {
                  name: attendee.emailAddress.name,
                  email: attendee.emailAddress.address,
                });
              } catch (_) {}
            }

            await supabaseAdmin.from('calendar_events').upsert(
              {
                user_id: user.id,
                outlook_event_id: ev.id,
                calendar_id: 'primary',
                title: ev.subject || 'Event',
                description: ev.body?.content || null,
                location: ev.location?.displayName || null,
                start_time: new Date(start).toISOString(),
                end_time: new Date(end).toISOString(),
                contact_id: contactId,
              },
              { onConflict: 'user_id,outlook_event_id' }
            );
          }
        } catch (err) {
          console.log('❌ Outlook Calendar sync failed:', err.message);
        }
      })()
    );

    // Run both in parallel
    await Promise.all(syncPromises);

    // -------------------- 🔍 FETCH LOCAL EVENTS --------------------
    const { start_time: queryStart, end_time: queryEnd } = req.query;

    let query = supabase
      .from('calendar_events')
      .select(`
        id,
        google_event_id,
        outlook_event_id,
        title,
        description,
        location,
        start_time,
        end_time,
        car_mobile_de_id,
        contact_id
      `)
      .eq('user_id', user.id)
      .is('deleted_at', null);

    // ✅ Overlapping range logic
    if (queryStart && queryEnd) {
      query = query
        .lte('start_time', queryEnd)
        .gte('end_time', queryStart);
    }

    const { data: rows, error } = await query.order('start_time', { ascending: true });
    if (error) throw new Error(error.message);

    // -------------------- 🚗 FETCH CAR DATA --------------------
    const eventsWithCarData = await Promise.all(
      (rows || []).map(async (event) => {
        if (!event.car_mobile_de_id) return event;

        try {
          const carResponse = await fetch(
            `https://services.mobile.de/search-api/search?customerId=${process.env.MOBILE_DE_CUSTOMER_ID}&externalId=${event.car_mobile_de_id}`,
            {
              headers: {
                Authorization: `Bearer ${process.env.MOBILE_DE_API_KEY}`,
                Accept: 'application/json',
              },
            }
          );

          if (!carResponse.ok) return event;

          const data = await carResponse.json();
          const rawCars =
            data?.['search-result']?.ads?.ad ||
            data?.ads ||
            (Array.isArray(data) ? data : []);

          if (!Array.isArray(rawCars) || rawCars.length === 0) return event;

          const c = rawCars[0];
          const make = c?.vehicle?.make?.['@key'] || c?.vehicle?.make || '';
          const model = c?.vehicle?.model?.['@key'] || c?.vehicle?.model || '';
          const modelDesc = c?.vehicle?.['model-description']?.['@value'] || '';
          const title = [make, model, modelDesc].filter(Boolean).join(' ').trim() || 'Car';

          const image =
            Array.isArray(c?.images) && c.images.length > 0
              ? c.images[0].url || c.images[0]?.src || null
              : null;

          return {
            ...event,
            car: {
              id: event.car_mobile_de_id,
              title,
              image,
              url: `https://suchen.mobile.de/fahrzeuge/details.html?id=${event.car_mobile_de_id}`,
            },
          };
        } catch (err) {
          console.error('Error fetching car data for event:', event.title, err);
          return event;
        }
      })
    );

    return res.json(eventsWithCarData || []);
  } catch (e) {
    console.error('Calendar listEvents error:', e);
    return res.status(500).json({ error: e.message || 'Failed to list events' });
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
    
    // Validate required fields
    if (!title || !start_time || !end_time) {
      return res.status(400).json({ error: 'Title, start_time, and end_time are required' });
    }
    
    // Validate date format
    try {
      new Date(start_time);
      new Date(end_time);
    } catch (dateError) {
      return res.status(400).json({ error: 'Invalid date format for start_time or end_time' });
    }
    
    let google_event_id = null;
    let outlook_event_id = null;
    let finalContactId = contact_id || null;
    
    // Try to create Google Calendar event if Gmail is connected
    try {
      const tokens = await getGmailTokens(user.id);
      if (tokens && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        const cal = await getAuthedCalendar(user.id);
        const requestBody = { 
          summary: title, 
          description: description || '', 
          location: location || '', 
          start: { dateTime: start_time }, 
          end: { dateTime: end_time } 
        };
        if (customer_email) {
          requestBody.attendees = [{ email: customer_email, displayName: customer_name || undefined }];
        }
        
        const g = await cal.events.insert({ calendarId: 'primary', requestBody });
        google_event_id = g.data.id;
        console.log('✅ Event created in Google Calendar:', google_event_id);
      }
    } catch (googleError) {
      console.log('❌ Google Calendar sync failed:', googleError.message);
      // Continue with local event creation even if Google Calendar fails
    }
    
    // Try to create Outlook Calendar event if Outlook is connected
    try {
      const outlookTokens = await getOutlookTokens(user.id);
      if (outlookTokens && process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET) {
        const outlook = await getAuthedOutlookCalendar(user.id);
        const eventData = {
          subject: title,
          body: { contentType: 'HTML', content: description || '' },
          location: location ? { displayName: location } : null,
          start: { dateTime: start_time, timeZone: 'UTC' },
          end: { dateTime: end_time, timeZone: 'UTC' },
          attendees: customer_email ? [{ emailAddress: { address: customer_email, name: customer_name || undefined }, type: 'required' }] : []
        };
        
        const outlookResponse = await axios.post(
          'https://graph.microsoft.com/v1.0/me/events',
          eventData,
          {
            headers: {
              'Authorization': `Bearer ${outlook.accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        outlook_event_id = outlookResponse.data.id;
        console.log('✅ Event created in Outlook Calendar:', outlook_event_id);
      }
    } catch (outlookError) {
      console.log('❌ Outlook Calendar sync failed:', outlookError.message);
      // Continue with local event creation even if Outlook Calendar fails
    }
    
    // Create or find contact
    if (!finalContactId && (customer_email || customer_name)) {
      try {
        finalContactId = await findOrCreateContact(user.id, { name: customer_name || null, email: customer_email || null });
      } catch (contactError) {
        console.log('Contact creation failed:', contactError.message);
      }
    }
    
    // Store event in local database
    const { data: created, error } = await supabaseAdmin.from('calendar_events').insert({ 
      user_id: user.id, 
      google_event_id: google_event_id || null, 
      outlook_event_id: outlook_event_id || null,
      calendar_id: 'primary', 
      title, 
      description, 
      location, 
      start_time, 
      end_time, 
      car_mobile_de_id: car_mobile_de_id || null, 
      contact_id: finalContactId || null 
    }).select('id').single();
    
    if (error) return res.status(500).json({ error: `Database error: ${error.message}` });
    return res.json({ 
      id: created.id, 
      google_event_id: google_event_id,
      outlook_event_id: outlook_event_id,
      message: getSyncMessage(google_event_id, outlook_event_id)
    });
  } catch (e) {
    console.error('Calendar createEvent error:', e);
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


