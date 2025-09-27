const supabase = require('../config/supabaseClient');
const { getUserFromRequest } = require('../utils/authUser');
const { runOnce: runImageWorkerOnce } = require('../worker/imageProcessor');
const { uploadBufferAdmin } = require('../utils/storage');

exports.enqueueProcessing = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { images = [], listing_id = null, overlay_logo_first = true, background = { type: 'white' }, provider = 'clipdrop' } = req.body || {};
    if (!Array.isArray(images) || images.length === 0) return res.status(400).json({ error: 'images required' });

    const jobs = [];
    for (let i = 0; i < images.length; i++) {
      const isFirst = i === 0;
      const options = {
        background: background || { type: 'white' },
        overlayLogo: overlay_logo_first && isFirst,
        outputFormat: 'png',
      };
      jobs.push({ user_id: userId, listing_id, original_url: images[i], provider, options });
    }

    const { data, error } = await supabase.from('image_processing_jobs').insert(jobs).select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ queued: data.map(r => r.id) });
  } catch (err) {
    console.error('enqueueProcessing error:', err);
    return res.status(500).json({ error: 'Failed to enqueue', details: err.message });
  }
};

exports.getJobStatus = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const { ids = [] } = req.query;
    const idsArr = Array.isArray(ids) ? ids : String(ids || '').split(',').filter(Boolean);
    if (idsArr.length === 0) return res.json([]);
    const { data, error } = await supabase
      .from('image_processing_jobs')
      .select('id, status, result_url, error')
      .in('id', idsArr)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    console.error('getJobStatus error:', err);
    return res.status(500).json({ error: 'Failed to get status', details: err.message });
  }
};

exports.reprocessListing = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const { listing_id, images = [], background = { type: 'white' }, overlay_logo_first = true, provider = 'clipdrop' } = req.body || {};
    if (!listing_id || !images.length) return res.status(400).json({ error: 'listing_id and images required' });

    const jobs = [];
    for (let i = 0; i < images.length; i++) {
      const isFirst = i === 0;
      const options = {
        background,
        overlayLogo: overlay_logo_first && isFirst,
        outputFormat: 'png',
      };
      jobs.push({ user_id: userId, listing_id, original_url: images[i], provider, options });
    }
    const { data, error } = await supabase.from('image_processing_jobs').insert(jobs).select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ requeued: data.map(r => r.id) });
  } catch (err) {
    console.error('reprocessListing error:', err);
    return res.status(500).json({ error: 'Failed to reprocess', details: err.message });
  }
};

// Run the image worker once (debug/helper)
exports.runOnce = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const result = await runImageWorkerOnce(10);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to run worker' });
  }
};

// Enqueue jobs from uploaded files
exports.enqueueFromUpload = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    // Upload each file to storage and enqueue by URL
    const urls = [];
    for (const f of files.slice(0, 20)) {
      const buf = f.buffer || null;
      // Multer diskStorage wrote to disk; read back
      const fs = require('fs');
      const path = require('path');
      const filePath = f.path || path.join('uploads', f.filename);
      const data = buf || fs.readFileSync(filePath);
      const uploaded = await uploadBufferAdmin({ buffer: data, contentType: f.mimetype || 'image/png', pathPrefix: 'uploads' });
      if (uploaded?.url) urls.push(uploaded.url);
    }

    if (!urls.length) return res.status(400).json({ error: 'Failed to upload files' });

    const jobs = urls.map((u, idx) => ({
      user_id: userId,
      original_url: u,
      provider: 'removebg',
      options: { background: { type: 'white' }, overlayLogo: idx === 0, outputFormat: 'png' },
    }));

    const { data, error } = await supabase.from('image_processing_jobs').insert(jobs).select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ queued: data.map(r => r.id) });
  } catch (err) {
    console.error('enqueueFromUpload error:', err);
    return res.status(500).json({ error: 'Failed to enqueue uploads', details: err.message });
  }
};


