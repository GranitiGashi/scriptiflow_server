const supabase = require('../config/supabaseClient');
const { removeBackground } = require('../utils/bgRemoval');
const { fetchBufferFromUrl, overlayLogo, replaceBackground } = require('../utils/imageUtils');
const { uploadBuffer } = require('../utils/storage');
const { getDealerLogoUrl } = require('../utils/dealerUtils');

async function processJob(job) {
  const options = job.options || {};
  const provider = job.provider || 'clipdrop';

  // 1) Download original
  const origBuffer = await fetchBufferFromUrl(job.original_url);

  // 2) Remove background -> PNG with alpha
  const cutout = await removeBackground({ imageBuffer: origBuffer, provider });

  let composed = cutout;
  // 3) Optional background replacement
  if (options.background?.type === 'white') {
    const white = Buffer.alloc(4, 255); // 1x1 white pixel won't work; create programmatically using sharp
    const sharp = require('sharp');
    const meta = await sharp(cutout).metadata();
    const bg = await sharp({ create: { width: meta.width || 1200, height: meta.height || 800, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    composed = await replaceBackground(cutout, bg);
  } else if (options.background?.type === 'template' && options.background?.url) {
    const bgBuf = await fetchBufferFromUrl(options.background.url);
    composed = await replaceBackground(cutout, bgBuf);
  } else if (options.background?.type === 'none' || !options.background) {
    // keep transparent PNG
  }

  // 4) Dealer logo overlay (usually only for the first image of a listing)
  if (options.overlayLogo === true) {
    try {
      // fetch credentials to query mobile.de logo if needed
      const { data: cred } = await supabase
        .from('mobile_de_credentials')
        .select('username, encrypted_password')
        .eq('user_id', job.user_id)
        .maybeSingle();
      let logoUrl = null;
      if (cred) {
        const { decrypt } = require('../utils/crypto');
        const [iv, enc] = (cred.encrypted_password || '').split(':');
        const pwd = decrypt(enc, iv);
        logoUrl = await getDealerLogoUrl({ userId: job.user_id, username: cred.username, password: pwd });
      }
      if (logoUrl) {
        const logoBuf = await fetchBufferFromUrl(logoUrl);
        composed = await overlayLogo(composed, logoBuf, { position: 'southeast', maxWidthRatio: 0.18, margin: 32, opacity: 0.95 });
      }
    } catch (e) {}
  }

  // 5) Upload result
  const contentType = options.outputFormat === 'jpg' ? 'image/jpeg' : 'image/png';
  const bufferToUpload = composed;
  const uploaded = await uploadBuffer({ buffer: bufferToUpload, contentType, pathPrefix: 'processed' });

  return uploaded.url;
}

async function runOnce(limit = 10) {
  const { data: jobs } = await supabase
    .from('image_processing_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (!jobs || !jobs.length) return { processed: 0 };

  let processed = 0;
  for (const job of jobs) {
    try {
      await supabase.from('image_processing_jobs').update({ status: 'processing', attempts: job.attempts + 1, updated_at: new Date().toISOString() }).eq('id', job.id);
      const url = await processJob(job);
      await supabase.from('image_processing_jobs').update({ status: 'success', result_url: url, error: null, updated_at: new Date().toISOString() }).eq('id', job.id);
      processed += 1;
    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
      await supabase.from('image_processing_jobs').update({ status: job.attempts + 1 >= 3 ? 'failed' : 'queued', error: msg, updated_at: new Date().toISOString() }).eq('id', job.id);
    }
  }
  return { processed };
}

module.exports = { runOnce };


