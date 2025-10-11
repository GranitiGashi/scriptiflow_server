// Simple in-memory rate limiter per key (IP/path). Suitable for low traffic or single-process deployments.
// For production at scale, replace with a distributed store (Redis) or a provider.

const buckets = new Map();

function defaultKeyGenerator(req) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '').toString();
  return `${ip}:${req.path}`;
}

function rateLimit(options = {}) {
  const windowMs = Number(options.windowMs || 60_000);
  const max = Number(options.max || 10);
  const keyGenerator = options.keyGenerator || defaultKeyGenerator;

  return function rateLimitMiddleware(req, res, next) {
    try {
      const now = Date.now();
      const key = keyGenerator(req);
      let entry = buckets.get(key);
      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        buckets.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > max) {
        res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }
      return next();
    } catch (e) {
      return next();
    }
  };
}

module.exports = { rateLimit };


