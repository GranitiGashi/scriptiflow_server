const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');
const { removeBackground } = require('../utils/bgRemoval');
const { fetchBufferFromUrl, overlayLogo, replaceBackground } = require('../utils/imageUtils');
const { uploadBufferAdmin } = require('../utils/storage');
const { getDealerLogoUrl } = require('../utils/dealerUtils');

async function processJob(job) {
  const options = job.options || {};
  const provider = job.provider || 'clipdrop';

  // 1) Download original
  const origBuffer = await fetchBufferFromUrl(job.original_url);

  // 2) Remove background -> PNG with alpha; enforce car presets by default
  let cutout;
  try {
    const removebgOptions = options?.removebg || {};
    removebgOptions.type = 'car';
    removebgOptions.shadow_type = removebgOptions.shadow_type || 'car';
    const applyWhiteViaRemovebg = options?.background?.type === 'white';
    if (applyWhiteViaRemovebg) {
      removebgOptions.bg_color = removebgOptions.bg_color || 'ffffff';
      removebgOptions.format = removebgOptions.format || 'png';
    }
    if (options?.background?.type === 'template') {
      // use provided URL or account background as remove.bg bg_image_url
      let templateUrl = options.background?.url || null;
      if (!templateUrl) {
        const { data: asset } = await supabaseAdmin
          .from('dealer_assets')
          .select('branded_template_url')
          .eq('user_id', job.user_id)
          .maybeSingle();
        templateUrl = asset?.branded_template_url || null;
      }
      if (templateUrl) {
        removebgOptions.bg_image_url = templateUrl;
        removebgOptions.format = removebgOptions.format || 'png';
      }
    }
    // If UI asked for white background, let removebg render it server-side
    // map basic UI size -> removebg size
    // if (options?.quality === 'preview') removebgOptions.size = 'preview';
    // if (options?.quality === 'full') removebgOptions.size = 'full';
    cutout = await removeBackground({ imageBuffer: origBuffer, provider, removebgOptions });
  } catch (e) {
    if (e?.isRateLimit) {
      // requeue with a small backoff timestamp
      await supabaseAdmin
        .from('image_processing_jobs')
        .update({ status: 'queued', error: 'rate_limited', updated_at: new Date().toISOString() })
        .eq('id', job.id);
      const waitMs = (e.retryAfter ? e.retryAfter * 1000 : 5000);
      await new Promise(r => setTimeout(r, waitMs));
      throw e; // let the runner loop move on; job will be retried
    }
    throw e;
  }

  let composed = cutout;
  // 3) Optional background replacement
  if (options.background?.type === 'white') {
    // If white background requested but not already applied via removebg, compose manually
    const appliedViaRemovebg = true; // because we set bg_color earlier when type === 'white'
    if (!appliedViaRemovebg) {
      const white = Buffer.alloc(4, 255); // 1x1 white pixel won't work; create programmatically using sharp
      const sharp = require('sharp');
      const meta = await sharp(cutout).metadata();
      const bg = await sharp({ create: { width: meta.width || 1200, height: meta.height || 800, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
      composed = await replaceBackground(cutout, bg);
    }
  } else if (options.background?.type === 'template') {
    // Background was applied by remove.bg via bg_image_url; no manual compose needed
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
      if (!logoUrl) {
        // fallback to assets page logo if set
        const { data: asset } = await supabaseAdmin
          .from('dealer_assets')
          .select('dealer_logo_url')
          .eq('user_id', job.user_id)
          .maybeSingle();
        logoUrl = asset?.dealer_logo_url || null;
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
  const uploaded = await uploadBufferAdmin({ buffer: bufferToUpload, contentType, pathPrefix: 'processed' });

  return uploaded.url;
}

async function runOnce(limit = 10) {
  const { data: jobs } = await supabaseAdmin
    .from('image_processing_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (!jobs || !jobs.length) return { processed: 0 };

  let processed = 0;
  for (const job of jobs) {
    try {
      // Claim the job atomically: only if it is still queued
      const { data: claimed } = await supabaseAdmin
        .from('image_processing_jobs')
        .update({ status: 'processing', attempts: job.attempts + 1, updated_at: new Date().toISOString() })
        .eq('id', job.id)
        .eq('status', 'queued')
        .select('id');
      if (!claimed || claimed.length === 0) {
        // Another worker already claimed it
        continue;
      }
      const url = await processJob(job);
      await supabaseAdmin.from('image_processing_jobs').update({ status: 'success', result_url: url, error: null, updated_at: new Date().toISOString() }).eq('id', job.id);
      processed += 1;
    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
      await supabaseAdmin.from('image_processing_jobs').update({ status: job.attempts + 1 >= 3 ? 'failed' : 'queued', error: msg, updated_at: new Date().toISOString() }).eq('id', job.id);
    }
  }
  return { processed };
}

module.exports = { runOnce };


