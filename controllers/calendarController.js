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
    if (auth.error) return res.status(auth.error.status || 401).json({ error: auth.error.message });
    const user = auth.user;
    
    // Try to sync with Google Calendar if Gmail is connected
    try {
      const tokens = await getGmailTokens(user.id);
      if (tokens && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        const cal = await getAuthedCalendar(user.id);
        const now = new Date();
        const past = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
        const future = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
        const { data } = await cal.events.list({ calendarId: 'primary', timeMin: past, timeMax: future, singleEvents: true, orderBy: 'startTime', maxResults: 2500 });

        console.log('🔄 Syncing Google Calendar events...');
        // upsert into local DB for quick retrieval
        const items = Array.isArray(data.items) ? data.items : [];
        for (const ev of items) {
          const start = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
          const end = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
          if (!start || !end) continue;
          // Try to link to a contact by attendee/description email
          let contactId = null;
          let emailCandidate = null;
          let nameCandidate = null;
          if (Array.isArray(ev.attendees) && ev.attendees.length) {
            const att = ev.attendees.find((a) => a.email && a.responseStatus !== 'declined') || ev.attendees[0];
            emailCandidate = att?.email || null;
            nameCandidate = att?.displayName || null;
          }
          if (!emailCandidate && typeof ev.description === 'string') {
            const m = ev.description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
            if (m) emailCandidate = m[0];
          }
          if (emailCandidate) {
            try { contactId = await findOrCreateContact(user.id, { name: nameCandidate, email: emailCandidate }); } catch (_) {}
          }
          await supabaseAdmin.from('calendar_events').upsert({
            user_id: user.id,
            google_event_id: ev.id,
            calendar_id: ev.organizer?.email || 'primary',
            title: ev.summary || 'Event',
            description: ev.description || null,
            location: ev.location || null,
            start_time: new Date(start).toISOString(),
            end_time: new Date(end).toISOString(),
            contact_id: contactId || null,
          }, { onConflict: 'user_id,google_event_id' });
        }
      }
    } catch (googleError) {
      console.log('❌ Google Calendar sync failed:', googleError.message);
      // Continue with local events retrieval
    }

    // Try to sync with Outlook Calendar if Outlook is connected
    try {
      const outlookTokens = await getOutlookTokens(user.id);
      if (outlookTokens && process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET) {
        const outlook = await getAuthedOutlookCalendar(user.id);
        const now = new Date();
        const past = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
        const future = new Date(now.getTime() + 60 * 24 * 3600 * 1000).toISOString();
        
        const outlookResponse = await axios.get(
          `https://graph.microsoft.com/v1.0/me/events?$filter=start/dateTime ge '${past}' and end/dateTime le '${future}'&$orderby=start/dateTime&$top=2500`,
          {
            headers: {
              'Authorization': `Bearer ${outlook.accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('🔄 Syncing Outlook Calendar events...');
        const events = Array.isArray(outlookResponse.data.value) ? outlookResponse.data.value : [];
        for (const ev of events) {
          const start = ev.start?.dateTime || null;
          const end = ev.end?.dateTime || null;
          if (!start || !end) continue;
          
          // Try to link to a contact by attendee email
          let contactId = null;
          let emailCandidate = null;
          let nameCandidate = null;
          if (Array.isArray(ev.attendees) && ev.attendees.length) {
            const att = ev.attendees.find((a) => a.emailAddress?.address) || ev.attendees[0];
            emailCandidate = att?.emailAddress?.address || null;
            nameCandidate = att?.emailAddress?.name || null;
          }
          if (emailCandidate) {
            try { contactId = await findOrCreateContact(user.id, { name: nameCandidate, email: emailCandidate }); } catch (_) {}
          }
          
          await supabaseAdmin.from('calendar_events').upsert({
            user_id: user.id,
            outlook_event_id: ev.id,
            calendar_id: 'primary',
            title: ev.subject || 'Event',
            description: ev.body?.content || null,
            location: ev.location?.displayName || null,
            start_time: new Date(start).toISOString(),
            end_time: new Date(end).toISOString(),
            contact_id: contactId || null,
          }, { onConflict: 'user_id,outlook_event_id' });
        }
      }
    } catch (outlookError) {
      console.log('❌ Outlook Calendar sync failed:', outlookError.message);
      // Continue with local events retrieval
    }

    // Return events from local database
    const { data: rows } = await supabase
      .from('calendar_events')
      .select('id, google_event_id, outlook_event_id, title, description, location, start_time, end_time, car_mobile_de_id, contact_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('start_time', { ascending: true });

    return res.json(rows || []);
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


