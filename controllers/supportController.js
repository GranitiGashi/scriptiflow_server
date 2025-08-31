const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');

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


