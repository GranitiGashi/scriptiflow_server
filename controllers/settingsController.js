const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { getUserFromRequest } = require('../utils/authUser');
const { uploadBufferAdmin } = require('../utils/storage');

exports.getAssets = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const { data } = await supabaseAdmin
      .from('dealer_assets')
      .select('dealer_logo_url, branded_template_url, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return res.json(data);

    // Fallback: read from users_app if values were stored there
    const { data: userRow } = await supabaseAdmin
      .from('users_app')
      .select('dealer_logo_url, branded_template_url, assets_updated_at')
      .eq('id', userId)
      .maybeSingle();
    return res.json(userRow || {});
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
    // Also store on users_app for convenience
    await supabaseAdmin
      .from('users_app')
      .update({ dealer_logo_url: out.dealer_logo_url, branded_template_url: out.branded_template_url, assets_updated_at: new Date().toISOString() })
      .eq('id', userId);

    return res.json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to upload assets' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const { getUserFromRequest } = require('../utils/authUser');
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    // Select all to avoid errors when optional columns (e.g., phone) are missing
    const { data, error } = await supabaseAdmin
      .from('users_app')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({
      email: data?.email || null,
      full_name: data?.full_name || null,
      company_name: data?.company_name || null,
      phone: data?.phone || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch profile' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { getUserFromRequest } = require('../utils/authUser');
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const { full_name, email, company_name, phone } = req.body || {};

    // Update users_app
    // Try update including phone; if column does not exist, retry without phone
    let upErr = null;
    let updateResult = await supabaseAdmin
      .from('users_app')
      .update({ full_name, email, company_name, phone, updated_at: new Date().toISOString() })
      .eq('id', userId);
    upErr = updateResult.error || null;
    if (upErr && /column\s+"?phone"?\s+does not exist/i.test(String(upErr.message))) {
      const retry = await supabaseAdmin
        .from('users_app')
        .update({ full_name, email, company_name, updated_at: new Date().toISOString() })
        .eq('id', userId);
      upErr = retry.error || null;
    }
    if (upErr) return res.status(400).json({ error: upErr.message });

    // If email changed, also update Supabase Auth email (optional)
    try {
      if (email && email !== authRes.user.email) {
        await supabaseAdmin.auth.admin.updateUserById(userId, { email });
      }
    } catch (_) {}

    return res.json({ status: 'updated' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update profile' });
  }
};


