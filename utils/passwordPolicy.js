// Basic password strength validator without external deps.
// Criteria:
// - Minimum 12 characters
// - At least one lowercase, one uppercase, one digit, and one symbol
// - Not in very common password list
// - Does not contain the email local part (before @) when provided

const VERY_COMMON = new Set([
  'password', '123456', '123456789', '12345678', 'qwerty', '111111', '123123',
  'abc123', 'password1', 'iloveyou', 'admin', 'letmein', 'welcome', 'monkey',
]);

async function hibpPwnedCount(password) {
  try {
    if (!process.env.HIBP_CHECK || String(process.env.HIBP_CHECK).toLowerCase() !== 'true') return 0;
    const crypto = require('crypto');
    const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!res.ok) return 0;
    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      const [suf, countStr] = line.trim().split(':');
      if (suf === suffix) return parseInt(countStr || '0', 10) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function validatePasswordStrengthAsync(password, email) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  if (password.length < 12) {
    return { valid: false, message: 'Password must be at least 12 characters long' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must include a lowercase letter' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must include an uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must include a number' };
  }
  if (!/[~`!@#$%^&*()_+\-={}\[\]|;:\"'<>,.?/]/.test(password)) {
    return { valid: false, message: 'Password must include a symbol' };
  }
  const normalized = password.toLowerCase();
  if (VERY_COMMON.has(normalized)) {
    return { valid: false, message: 'Password is too common' };
  }
  if (email && typeof email === 'string') {
    const local = String(email).split('@')[0]?.toLowerCase();
    if (local && local.length >= 3 && normalized.includes(local)) {
      return { valid: false, message: 'Password must not contain your email' };
    }
  }
  const pwned = await hibpPwnedCount(password);
  if (pwned > 0) {
    return { valid: false, message: 'Password has appeared in data breaches; choose a different one' };
  }
  return { valid: true };
}

function validatePasswordStrength(password, email) {
  // Synchronous fallback used where async is inconvenient; does everything except HIBP.
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  if (password.length < 12) {
    return { valid: false, message: 'Password must be at least 12 characters long' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must include a lowercase letter' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must include an uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must include a number' };
  }
  if (!/[~`!@#$%^&*()_+\-={}\[\]|;:\"'<>,.?/]/.test(password)) {
    return { valid: false, message: 'Password must include a symbol' };
  }
  const normalized = password.toLowerCase();
  if (VERY_COMMON.has(normalized)) {
    return { valid: false, message: 'Password is too common' };
  }
  if (email && typeof email === 'string') {
    const local = String(email).split('@')[0]?.toLowerCase();
    if (local && local.length >= 3 && normalized.includes(local)) {
      return { valid: false, message: 'Password must not contain your email' };
    }
  }
  return { valid: true };
}

module.exports = { validatePasswordStrength, validatePasswordStrengthAsync };


