const axios = require('axios');
const FormData = require('form-data');

async function removeBackgroundClipdrop(imageBuffer) {
  const key = process.env.CLIPDROP_API_KEY;
  if (!key) throw new Error('Missing CLIPDROP_API_KEY');
  const fd = new FormData();
  fd.append('image_file', imageBuffer, { filename: 'image.png' });
  const res = await axios.post('https://api.clipdrop.co/remove-background/v1', fd, {
    headers: { ...fd.getHeaders(), 'x-api-key': key },
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Clipdrop failed: ${res.status} ${res.data?.toString?.() || ''}`);
  }
  return Buffer.from(res.data);
}

async function removeBackgroundRemoveBg(imageBuffer, options = {}) {
  const key = process.env.REMOVEBG_API_KEY;
  if (!key) throw new Error('Missing REMOVEBG_API_KEY');
  const fd = new FormData();
  fd.append('image_file', imageBuffer, { filename: 'image.png' });
  const {
    size = process.env.REMOVEBG_DEFAULT_SIZE || 'auto',
    type = process.env.REMOVEBG_DEFAULT_TYPE || 'auto',
    type_level,
    format = process.env.REMOVEBG_DEFAULT_FORMAT || 'auto',
    roi,
    crop,
    crop_margin,
    scale,
    position,
    channels,
    shadow_type,
    shadow_opacity,
    semitransparency,
    bg_color,
  } = options || {};
  if (size) fd.append('size', String(size));
  if (type) fd.append('type', String(type));
  if (type_level) fd.append('type_level', String(type_level));
  if (format) fd.append('format', String(format));
  if (roi) fd.append('roi', String(roi));
  if (typeof crop === 'boolean') fd.append('crop', crop ? 'true' : 'false');
  if (crop_margin) fd.append('crop_margin', String(crop_margin));
  if (scale) fd.append('scale', String(scale));
  if (position) fd.append('position', String(position));
  if (channels) fd.append('channels', String(channels));
  if (shadow_type) fd.append('shadow_type', String(shadow_type));
  if (typeof shadow_opacity !== 'undefined') fd.append('shadow_opacity', String(shadow_opacity));
  if (typeof semitransparency === 'boolean') fd.append('semitransparency', semitransparency ? 'true' : 'false');
  if (bg_color) fd.append('bg_color', String(bg_color).replace('#', ''));
  const res = await axios.post('https://api.remove.bg/v1.0/removebg', fd, {
    headers: { ...fd.getHeaders(), 'X-Api-Key': key },
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });
  if (res.status === 429) {
    const err = new Error('removebg rate limit');
    err.isRateLimit = true;
    const ra = res.headers?.['retry-after'];
    err.retryAfter = ra ? parseInt(ra, 10) : null;
    throw err;
  }
  if (res.status < 200 || res.status >= 300) {
    const e = new Error(`Remove.bg failed: ${res.status}`);
    e.statusCode = res.status;
    throw e;
  }
  return Buffer.from(res.data);
}

async function removeBackground({ imageBuffer, provider = 'clipdrop', removebgOptions = {} }) {
  // Prefer Remove.bg if key is present and provider not explicitly clipdrop
  if (provider === 'removebg' || (process.env.REMOVEBG_API_KEY && provider !== 'clipdrop')) {
    return await removeBackgroundRemoveBg(imageBuffer, removebgOptions);
  }
  return await removeBackgroundClipdrop(imageBuffer);
}

module.exports = { removeBackground };

