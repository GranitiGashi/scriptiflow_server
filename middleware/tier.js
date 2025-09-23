const supabaseAdmin = require('../config/supabaseAdmin');

function compareTier(current, required) {
  if (!current) return false;
  if (current === '*') return true;
  const order = { basic: 1, pro: 2, premium: 3 };
  const c = order[current] || 0;
  const r = order[required] || 0;
  return c >= r;
}

function requireTierOrAbove(required) {
  return async (req, res, next) => {
    try {
      const user = req.authUser;
      if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await supabaseAdmin
        .from('users_app')
        .select('role, permissions')
        .eq('id', user.id)
        .single();
      if (error) return res.status(500).json({ error: 'Failed to verify tier' });
      if (data?.role === 'admin') return next();
      const tier = (data?.permissions && (data.permissions.tier || data.permissions?.['tier'])) || null;
      if (!compareTier(tier, required)) {
        return res.status(403).json({ error: `Requires ${required} tier or above` });
      }
      return next();
    } catch (e) {
      return res.status(500).json({ error: 'Tier check failed' });
    }
  };
}

module.exports = { requireTierOrAbove };


