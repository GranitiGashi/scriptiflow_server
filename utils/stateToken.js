const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = input.length % 4;
  if (pad) input += '='.repeat(4 - pad);
  return Buffer.from(input, 'base64');
}

function sign(payloadObj, secret) {
  const payload = { ...payloadObj };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64url(payloadJson);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadB64);
  const sig = hmac.digest();
  const sigB64 = base64url(sig);
  return `${payloadB64}.${sigB64}`;
}

function verify(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return { valid: false };
  const [payloadB64, sigB64] = token.split('.', 2);
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  const provided = fromBase64url(sigB64);
  if (expected.length !== provided.length) return { valid: false };
  if (!crypto.timingSafeEqual(expected, provided)) return { valid: false };
  try {
    const payloadJson = fromBase64url(payloadB64).toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (payload.exp && Date.now() > Number(payload.exp)) return { valid: false, reason: 'expired' };
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

module.exports = { sign, verify };


