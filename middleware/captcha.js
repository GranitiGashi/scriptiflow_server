// Optional CAPTCHA verification middleware (Google reCAPTCHA v2/v3 or hCaptcha compatible)
// Requires CAPTCHA_PROVIDER and provider secret in env if enabled.

async function verifyWithGoogle(token, secret) {
  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch (_) {
    return false;
  }
}

async function verifyWithHCaptcha(token, secret) {
  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  try {
    const res = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch (_) {
    return false;
  }
}

function captchaRequired(options = {}) {
  const provider = (process.env.CAPTCHA_PROVIDER || '').toLowerCase();
  const secret = process.env.CAPTCHA_SECRET;
  const enabled = provider && secret;

  return async function captchaMiddleware(req, res, next) {
    if (!enabled) return next();
    const token = (req.body && (req.body.captcha_token || req.body.captchaToken)) || req.headers['x-captcha-token'];
    if (!token) return res.status(400).json({ error: 'Captcha verification required' });
    let ok = false;
    if (provider === 'recaptcha' || provider === 'google') ok = await verifyWithGoogle(token, secret);
    else if (provider === 'hcaptcha') ok = await verifyWithHCaptcha(token, secret);
    if (!ok) return res.status(400).json({ error: 'Captcha verification failed' });
    return next();
  };
}

module.exports = { captchaRequired };


