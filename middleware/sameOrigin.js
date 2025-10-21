// Same-origin enforcement for sensitive POSTs.
// Checks Origin and Referer headers against allowed origins.

function sameOrigin(required = true) {
  // Build list of allowed origins
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'https://www.scriptiflow.com',
    'https://scriptiflow.com',
  ].filter(Boolean).map(url => url.toLowerCase());

  return function sameOriginMiddleware(req, res, next) {
    if (!required) return next();
    try {
      const method = (req.method || 'GET').toUpperCase();
      if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return next();
      
      const origin = String(req.headers.origin || '').toLowerCase();
      const referer = String(req.headers.referer || '').toLowerCase();
      
      // If no origins configured, allow through
      if (allowedOrigins.length === 0) return next();
      
      // Check if origin matches any allowed origin
      for (const allowed of allowedOrigins) {
        if (origin && origin.startsWith(allowed)) return next();
        if (referer && referer.startsWith(allowed)) return next();
      }
      
      // Log blocked request for debugging
      console.warn(`[sameOrigin] Blocked request from origin: ${origin || 'none'}, referer: ${referer || 'none'}`);
      return res.status(403).json({ error: 'Forbidden: cross-origin request blocked' });
    } catch (err) {
      console.error('[sameOrigin] Error:', err.message);
      return res.status(403).json({ error: 'Forbidden' });
    }
  };
}

module.exports = { sameOrigin };


