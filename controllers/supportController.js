const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const { sendEmail } = require('../utils/email');

async function getCurrentUser(req) {
  const { user, error } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
  if (error) {
    const err = new Error(error.message);
    err.status = error.status || 401;
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
      .select(`
        id, subject, message, status, created_at, updated_at,
        support_messages:support_messages!support_messages_ticket_id_fkey ( id, created_at, user_id ),
        support_reads:support_reads!support_reads_ticket_id_fkey ( last_read_at, user_id )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch tickets', details: error.message });
    }
    // Compute unread counts from client perspective (admin replies not yet read)
    const withUnread = (data || []).map(t => {
      const messages = Array.isArray(t.support_messages) ? t.support_messages : [];
      const reads = Array.isArray(t.support_reads) ? t.support_reads : [];
      const myRead = reads.find(r => r.user_id === user.id);
      const lastReadAt = myRead?.last_read_at ? new Date(myRead.last_read_at).getTime() : 0;
      const unreadCount = messages.filter(m => new Date(m.created_at).getTime() > lastReadAt && m.user_id !== user.id).length;
      // Remove nested relations for cleaner response
      const { support_messages, support_reads, ...ticket } = t;
      return { ...ticket, unread_count: unreadCount };
    });
    return res.json(withUnread);
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
      .select(`
        id, user_id, subject, message, status, created_at, updated_at,
        users_app:users_app!support_tickets_user_id_fkey ( full_name, email ),
        support_messages:support_messages!support_messages_ticket_id_fkey ( id, created_at, user_id ),
        support_reads:support_reads!support_reads_ticket_id_fkey ( last_read_at, user_id )
      `)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch tickets', details: error.message });
    // Compute unread counts per ticket from admin perspective
    const byTicket = (data || []).map(t => {
      const messages = Array.isArray(t.support_messages) ? t.support_messages : [];
      const reads = Array.isArray(t.support_reads) ? t.support_reads : [];
      const adminRead = reads.find(r => r.user_id === user.id);
      const lastReadAt = adminRead?.last_read_at ? new Date(adminRead.last_read_at).getTime() : 0;
      // Count messages created after admin's last read
      const unreadCount = messages.filter(m => new Date(m.created_at).getTime() > lastReadAt && m.user_id !== user.id).length;
      return { ...t, unread_count: unreadCount };
    });
    return res.json(byTicket || []);
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

    // Handle uploaded files (multer memory storage)
    let attachments = null;
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length) {
        const { uploadBufferAdmin } = require('../utils/storage');
        const uploaded = [];
        for (const f of files.slice(0, 5)) {
          const up = await uploadBufferAdmin({ buffer: f.buffer, contentType: f.mimetype, pathPrefix: `support/${ticket_id}` });
          uploaded.push({ name: f.originalname, mime: f.mimetype, size: f.size, url: up.url, path: up.path });
        }
        attachments = uploaded;
      }
    } catch (_) {}

    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .insert([{ ticket_id, user_id: user.id, message, attachments }])
      .select('id, message, attachments, created_at')
      .single();
    if (error) return res.status(500).json({ error: 'Failed to add message', details: error.message });

    // Email logic: Only send email on first admin reply to a ticket
    try {
      if (isAdmin && ticket?.user_id) {
        // Check if this is the first admin message on this ticket
        const { data: prevAdminMsgs } = await supabaseAdmin
          .from('support_messages')
          .select('id')
          .eq('ticket_id', ticket_id)
          .neq('user_id', ticket.user_id)
          .limit(2);
        const isFirstAdminReply = Array.isArray(prevAdminMsgs) && prevAdminMsgs.length === 1; // Only the one we just inserted
        
        if (isFirstAdminReply) {
          const { data: tUser } = await supabaseAdmin
            .from('users_app')
            .select('email')
            .eq('id', ticket.user_id)
            .single();
          if (tUser?.email) {
            await sendEmail({
              to: tUser.email,
              subject: `Update on your support ticket: ${ticket.subject}`,
              text: `We have responded to your ticket.\n\nMessage:\n${message}\n\nView and reply at your support dashboard.`,
              html: `<p>We have responded to your ticket.</p><p><strong>Message:</strong><br/>${message.replace(/\n/g, '<br/>')}</p><p>View and reply at your support dashboard.</p>`
            });
          }
        }
      }
    } catch (e) {
      console.log('Email send skipped/failed:', e?.message || e);
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
      .select('id, user_id, message, attachments, created_at')
      .eq('ticket_id', ticket_id)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
    // Update read receipt for this user
    try {
      await supabaseAdmin
        .from('support_reads')
        .upsert({ user_id: user.id, ticket_id, last_read_at: new Date().toISOString() });
    } catch (e) {}
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

    // Only notify user if status changed to closed (resolved)
    try {
      if (status === 'closed') {
        const { data: tUser } = await supabaseAdmin
          .from('users_app')
          .select('email')
          .eq('id', ticket.user_id)
          .single();
        if (tUser?.email) {
          await sendEmail({
            to: tUser.email,
            subject: `Your support ticket has been resolved`,
            text: `Your support ticket ("${ticket.subject}") has been marked as resolved. If you need further assistance, feel free to create a new ticket.`,
            html: `<p>Your support ticket ("<strong>${ticket.subject}</strong>") has been marked as resolved.</p><p>If you need further assistance, feel free to create a new ticket.</p>`
          });
        }
      }
    } catch (e) {
      console.log('Email send skipped/failed:', e?.message || e);
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};


