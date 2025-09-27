const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const { uploadBufferAdmin } = require('../utils/storage');

exports.getAssets = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const { data } = await supabase
      .from('dealer_assets')
      .select('dealer_logo_url, branded_template_url, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    return res.json(data || {});
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch assets' });
  }
};

exports.uploadAssets = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const files = req.files || {};
    const out = {};

    if (files.logo && files.logo[0]) {
      const f = files.logo[0];
      const uploaded = await uploadBufferAdmin({ buffer: f.buffer, contentType: f.mimetype || 'image/png', pathPrefix: `dealer-assets/${userId}` });
      out.dealer_logo_url = uploaded.url;
    }
    if (files.background && files.background[0]) {
      const f = files.background[0];
      const uploaded = await uploadBufferAdmin({ buffer: f.buffer, contentType: f.mimetype || 'image/png', pathPrefix: `dealer-assets/${userId}` });
      out.branded_template_url = uploaded.url;
    }

    if (!Object.keys(out).length) return res.status(400).json({ error: 'No files uploaded' });

    await supabaseAdmin
      .from('dealer_assets')
      .upsert({ user_id: userId, ...out, updated_at: new Date().toISOString() }, { onConflict: ['user_id'] });

    return res.json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to upload assets' });
  }
};


