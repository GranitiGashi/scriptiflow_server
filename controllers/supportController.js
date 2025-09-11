const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { sendEmail } = require('../utils/email');

async function getCurrentUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Unauthorized: Missing token');
    err.status = 401;
    throw err;
  }
  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    const err = new Error('Invalid or expired token');
    err.status = 401;
    throw err;
  }
  return user;
}

exports.createTicket = async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const { subject, message } = req.body || {};
    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .insert([{ user_id: user.id, subject, message, status: 'open' }])
      .select('id, subject, message, status, created_at')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to create ticket', details: error.message });
    }
    // Send acknowledgement email
    try {
      await sendEmail({
        to: user.email,
        subject: `Support ticket received: ${subject}`,
        text: `Thanks for contacting support. We received your ticket and will respond soon.\n\nSubject: ${subject}\nMessage: ${message}`,
        html: `<p>Thanks for contacting support. We received your ticket and will respond soon.</p><p><strong>Subject:</strong> ${subject}</p><p><strong>Message:</strong><br/>${message.replace(/\n/g, '<br/>')}</p>`
      });
    } catch (e) {
      console.log('Email send skipped/failed:', e?.message || e);
    }
    // Notify admins by email (optional: use a configured admin email)
    try {
      const adminEmail = process.env.ADMIN_NOTIFICATIONS_EMAIL;
      if (adminEmail) {
        await sendEmail({
          to: adminEmail,
          subject: `New support ticket: ${subject}`,
          text: `A new ticket was created by ${user.email}.\n\n${message}`,
          html: `<p>A new ticket was created by ${user.email}.</p><p>${message.replace(/\n/g, '<br/>')}</p>`
        });
      }
    } catch (e) {
      console.log('Admin notify skipped/failed:', e?.message || e);
    }
    return res.status(201).json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

exports.listMyTickets = async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .select('id, subject, message, status, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch tickets', details: error.message });
    }
    return res.json(data || []);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

exports.listAllTickets = async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    // Verify admin role via users_app
    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', user.id)
      .single();
    if (meErr) return res.status(500).json({ error: 'Failed to verify role', details: meErr.message });
    if (me.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const { data, error } = await supabaseAdmin
      .from('support_tickets')
      .select('id, user_id, subject, message, status, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch tickets', details: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

// Basic chat/messages within a ticket
exports.addMessage = async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const { ticket_id, message } = req.body || {};
    if (!ticket_id || !message) return res.status(400).json({ error: 'ticket_id and message are required' });

    // Ensure ticket belongs to user or user is admin
    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', user.id)
      .single();
    const isAdmin = !meErr && me?.role === 'admin';

    const { data: ticket, error: tErr } = await supabaseAdmin
      .from('support_tickets')
      .select('id, user_id, subject, status')
      .eq('id', ticket_id)
      .single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!isAdmin && ticket.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .insert([{ ticket_id, user_id: user.id, message }])
      .select('id, message, created_at')
      .single();
    if (error) return res.status(500).json({ error: 'Failed to add message', details: error.message });

    // Notify ticket owner if reply from admin
    try {
      if (isAdmin && ticket?.user_id) {
        const { data: tUser } = await supabaseAdmin
          .from('users_app')
          .select('email')
          .eq('id', ticket.user_id)
          .single();
        if (tUser?.email) {
          await sendEmail({
            to: tUser.email,
            subject: `Update on your support ticket: ${ticket.subject}`,
            text: `We have responded to your ticket.\n\nMessage:\n${message}`,
            html: `<p>We have responded to your ticket.</p><p><strong>Message:</strong><br/>${message.replace(/\n/g, '<br/>')}</p>`
          });
        }
      }
    } catch (e) {
      console.log('Email send skipped/failed:', e?.message || e);
    }

    // Notify admins on any new message from users
    try {
      const adminEmail = process.env.ADMIN_NOTIFICATIONS_EMAIL;
      const isFromAdmin = isAdmin;
      if (!isFromAdmin && adminEmail) {
        await sendEmail({
          to: adminEmail,
          subject: `New message on ticket ${ticket.id}: ${ticket.subject}`,
          text: `Message from ${user.email}:\n\n${message}`,
          html: `<p>Message from ${user.email}:</p><p>${message.replace(/\n/g, '<br/>')}</p>`
        });
      }
    } catch (e) {
      console.log('Admin notify skipped/failed:', e?.message || e);
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

exports.listMessages = async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const { ticket_id } = req.query;
    if (!ticket_id) return res.status(400).json({ error: 'ticket_id is required' });

    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', user.id)
      .single();
    const isAdmin = !meErr && me?.role === 'admin';

    const { data: ticket, error: tErr } = await supabaseAdmin
      .from('support_tickets')
      .select('id, user_id')
      .eq('id', ticket_id)
      .single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!isAdmin && ticket.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('id, user_id, message, created_at')
      .eq('ticket_id', ticket_id)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const { ticket_id, status } = req.body || {};
    if (!ticket_id || !status) return res.status(400).json({ error: 'ticket_id and status are required' });

    // admin only
    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', user.id)
      .single();
    if (meErr || me?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const { data: ticket, error: tErr } = await supabaseAdmin
      .from('support_tickets')
      .select('id, user_id, subject')
      .eq('id', ticket_id)
      .single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Ticket not found' });

    const { error } = await supabaseAdmin
      .from('support_tickets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', ticket_id);
    if (error) return res.status(500).json({ error: 'Failed to update status', details: error.message });

    // notify user
    try {
      const { data: tUser } = await supabaseAdmin
        .from('users_app')
        .select('email')
        .eq('id', ticket.user_id)
        .single();
      if (tUser?.email) {
        await sendEmail({
          to: tUser.email,
          subject: `Your ticket status changed to ${status}`,
          text: `We updated your support ticket ("${ticket.subject}") status to ${status}.`,
          html: `<p>We updated your support ticket ("<strong>${ticket.subject}</strong>") status to <strong>${status}</strong>.</p>`
        });
      }
    } catch (e) {
      console.log('Email send skipped/failed:', e?.message || e);
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};


