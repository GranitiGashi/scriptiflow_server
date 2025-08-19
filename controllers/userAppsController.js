const supabase = require('../config/supabaseClient');

// Get user's apps
exports.getUserApps = async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  
  const token = authHeader.split(' ')[1];
  const refreshToken = req.headers['x-refresh-token'] || '';

  try {
    const { data: { user }, error: tokenError } = await supabase.auth.getUser(token);
    if (tokenError || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Set session for RLS
    await supabase.auth.setSession({
      access_token: token,
      refresh_token: refreshToken || null,
    });

    // Get user's apps, ordered by position
    const { data: apps, error } = await supabase
      .from('user_apps')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('position', { ascending: true });

    if (error) {
      console.error('Error fetching user apps:', error);
      return res.status(500).json({ error: 'Failed to fetch apps' });
    }

    // If user has no apps, copy default apps
    if (!apps || apps.length === 0) {
      await copyDefaultAppsForUser(user.id);
      
      // Fetch again after copying defaults
      const { data: newApps, error: newError } = await supabase
        .from('user_apps')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('position', { ascending: true });

      if (newError) {
        console.error('Error fetching apps after default copy:', newError);
        return res.status(500).json({ error: 'Failed to setup default apps' });
      }

      return res.json(newApps || []);
    }

    res.json(apps);
  } catch (err) {
    console.error('getUserApps error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Add or update user app
exports.upsertUserApp = async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  
  const token = authHeader.split(' ')[1];
  const refreshToken = req.headers['x-refresh-token'] || '';
  const { id, name, icon_url, external_url, background_color, text_color, position } = req.body;

  if (!name || !external_url) {
    return res.status(400).json({ error: 'Name and external_url are required' });
  }

  try {
    const { data: { user }, error: tokenError } = await supabase.auth.getUser(token);
    if (tokenError || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Set session for RLS
    await supabase.auth.setSession({
      access_token: token,
      refresh_token: refreshToken || null,
    });

    const appData = {
      user_id: user.id,
      name,
      icon_url: icon_url || null,
      external_url,
      background_color: background_color || '#f3f4f6',
      text_color: text_color || '#374151',
      position: position || 0,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (id) {
      // Update existing app
      const { data, error } = await supabase
        .from('user_apps')
        .update(appData)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Create new app
      appData.created_at = new Date().toISOString();
      const { data, error } = await supabase
        .from('user_apps')
        .insert(appData)
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    res.json(result);
  } catch (err) {
    console.error('upsertUserApp error:', err);
    res.status(500).json({ error: 'Failed to save app' });
  }
};

// Delete user app
exports.deleteUserApp = async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  
  const token = authHeader.split(' ')[1];
  const refreshToken = req.headers['x-refresh-token'] || '';
  const { id } = req.params;

  try {
    const { data: { user }, error: tokenError } = await supabase.auth.getUser(token);
    if (tokenError || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Set session for RLS
    await supabase.auth.setSession({
      access_token: token,
      refresh_token: refreshToken || null,
    });

    const { error } = await supabase
      .from('user_apps')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;

    res.json({ message: 'App deleted successfully' });
  } catch (err) {
    console.error('deleteUserApp error:', err);
    res.status(500).json({ error: 'Failed to delete app' });
  }
};

// Helper function to copy default apps for new users
async function copyDefaultAppsForUser(userId) {
  try {
    // Use the database function we created
    const { error } = await supabase.rpc('copy_default_apps_for_user', {
      target_user_id: userId
    });

    if (error) {
      console.error('Error copying default apps:', error);
    } else {
      console.log(`Copied default apps for user ${userId}`);
    }
  } catch (err) {
    console.error('copyDefaultAppsForUser error:', err);
  }
}

module.exports = { copyDefaultAppsForUser };
