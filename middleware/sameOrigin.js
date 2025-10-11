// Simple same-origin enforcement for sensitive POSTs.
// Checks Origin and Referer headers against configured FRONTEND_URL.

function sameOrigin(required = true) {
  const allowed = (process.env.FRONTEND_URL || '').toLowerCase();
  return function sameOriginMiddleware(req, res, next) {
    if (!required) return next();
    try {
      const method = (req.method || 'GET').toUpperCase();
      if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return next();
      const origin = String(req.headers.origin || '').toLowerCase();
      const referer = String(req.headers.referer || '').toLowerCase();
      if (!allowed) return next();
      if (origin && origin.startsWith(allowed)) return next();
      if (referer && referer.startsWith(allowed)) return next();
      return res.status(403).json({ error: 'Forbidden: cross-origin request blocked' });
    } catch (_) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  };
}

module.exports = { sameOrigin };


