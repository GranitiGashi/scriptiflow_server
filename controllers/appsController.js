// controllers/appsController.js
const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');

async function getSessionUser(req) {
  const { user, error } = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
  if (error) {
    const err = new Error(error.message);
    err.status = error.status || 401;
    throw err;
  }
  return user;
}

exports.getUserApps = async (req, res) => {
  try {
    const user = await getSessionUser(req);

    const { data, error } = await supabaseAdmin
      .from('sso_applications')
      .select('id, user_id, name, icon_url, external_url, background_color, text_color, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch apps', details: error.message });
    }

    // Map to frontend shape; mark as admin-created to lock editing in AppBoxes
    const apps = (data || []).map((row, index) => ({
      id: row.id,
      name: row.name || '',
      icon_url: row.icon_url || null,
      external_url: row.external_url || '',
      background_color: row.background_color || '#f3f4f6',
      text_color: row.text_color || '#374151',
      position: index + 1,
      is_admin_created: true,
      is_locked: true,
    }));

    return res.json(apps);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Server error' });
  }
};

// Admin helpers reused in admin controller, exported for convenience
exports._helpers = { getSessionUser };


