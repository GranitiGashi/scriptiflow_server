const sharp = require('sharp');
const axios = require('axios');

async function fetchBufferFromUrl(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', validateStatus: () => true });
  if (res.status < 200 || res.status >= 300) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return Buffer.from(res.data);
}

async function overlayLogo(baseBuffer, logoBuffer, options = {}) {
  const {
    position = 'southeast',
    maxWidthRatio = 0.2, // logo width <= 20% of image width
    margin = 24,
    opacity = 1.0,
  } = options;

  const baseMeta = await sharp(baseBuffer).metadata();
  const targetLogoWidth = Math.round((baseMeta.width || 1000) * maxWidthRatio);

  const logoResized = await sharp(logoBuffer)
    .resize({ width: targetLogoWidth, withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer();

  // Use blend: over with opacity to preserve base alpha
  const composite = [{ input: logoResized, gravity: position, top: margin, left: margin, blend: 'over', opacity }];
  return await sharp(baseBuffer).ensureAlpha().composite(composite).png().toBuffer();
}

async function replaceBackground(foregroundPngBuffer, backgroundBuffer, options = {}) {
  const { blur = 0 } = options;
  let bg = sharp(backgroundBuffer).ensureAlpha();
  if (blur > 0) bg = bg.blur(blur);
  const fg = sharp(foregroundPngBuffer).ensureAlpha();
  const fgMeta = await fg.metadata();
  const bgResized = await bg.resize({ width: fgMeta.width, height: fgMeta.height, fit: 'cover' }).toBuffer();
  return await sharp(bgResized).composite([{ input: await fg.png().toBuffer() }]).png().toBuffer();
}

module.exports = { fetchBufferFromUrl, overlayLogo, replaceBackground };

