// controllers/adminController.js
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { _helpers } = require('./appsController');

exports.listUsers = async (req, res) => {
  try {
    const user = await _helpers.getSessionUser(req);
    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', user.id)
      .single();

    if (meErr) {
      return res.status(500).json({ error: 'Failed to verify role', details: meErr.message });
    }
    if (me.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { data, error } = await supabaseAdmin
      .from('users_app')
      .select('id, email, full_name, company_name, role')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch users', details: error.message });
    }
    return res.json(data || []);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Server error' });
  }
};

exports.createUserApp = async (req, res) => {
  try {
    const current = await _helpers.getSessionUser(req);
    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', current.id)
      .single();
    if (meErr) return res.status(500).json({ error: 'Failed to verify role', details: meErr.message });
    if (me.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const { user_id, name, icon_url, external_url, background_color, text_color } = req.body;
    if (!user_id || !name || !external_url) {
      return res.status(400).json({ error: 'user_id, name and external_url are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('sso_applications')
      .insert([{ user_id, name, icon_url, external_url, background_color, text_color }])
      .select('id')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to create app', details: error.message });
    }
    return res.status(201).json({ id: data.id });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Server error' });
  }
};

exports.deleteUserApp = async (req, res) => {
  try {
    const current = await _helpers.getSessionUser(req);
    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', current.id)
      .single();
    if (meErr) return res.status(500).json({ error: 'Failed to verify role', details: meErr.message });
    if (me.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { error } = await supabaseAdmin
      .from('sso_applications')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: 'Failed to delete app', details: error.message });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Server error' });
  }
};

exports.listUserApps = async (req, res) => {
  try {
    const current = await _helpers.getSessionUser(req);
    const { data: me, error: meErr } = await supabase
      .from('users_app')
      .select('role')
      .eq('id', current.id)
      .single();
    if (meErr) return res.status(500).json({ error: 'Failed to verify role', details: meErr.message });
    if (me.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id query param is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('sso_applications')
      .select('id, user_id, name, icon_url, external_url, background_color, text_color, created_at')
      .eq('user_id', user_id)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: 'Failed to fetch user apps', details: error.message });
    return res.json(data || []);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Server error' });
  }
};


