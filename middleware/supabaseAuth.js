const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');

async function requireSupabaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    req.authUser = user;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Auth verification failed' });
  }
}

async function requireAdminRole(req, res, next) {
  try {
    const user = req.authUser;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data, error } = await supabaseAdmin
      .from('users_app')
      .select('role')
      .eq('id', user.id)
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to verify user role' });
    }

    if (!data || data.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: 'Role verification failed' });
  }
}

module.exports = { requireSupabaseAuth, requireAdminRole };


