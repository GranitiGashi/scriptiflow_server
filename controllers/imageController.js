const supabase = require('../config/supabaseClient');
const { getUserFromRequest } = require('../utils/authUser');
const { runOnce: runImageWorkerOnce } = require('../worker/imageProcessor');
const { uploadBufferAdmin } = require('../utils/storage');
const axios = require('axios');
const archiver = require('archiver');

exports.enqueueProcessing = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;

    const { images = [], listing_id = null, overlay_logo_first = true, background = { type: 'none' }, provider = 'clipdrop' } = req.body || {};
    if (!Array.isArray(images) || images.length === 0) return res.status(400).json({ error: 'images required' });

    const jobs = [];
    for (let i = 0; i < images.length; i++) {
      const isFirst = i === 0;
      const options = {
        background: background || { type: 'none' },
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
    const bgType = (req.body?.backgroundType || 'none').toString();
    const templateUrl = (req.body?.templateUrl || '').toString();
    let background = { type: 'none' };
    if (bgType === 'white') background = { type: 'white' };
    if (bgType === 'template' && templateUrl) background = { type: 'template', url: templateUrl };

    // Upload each file to storage and enqueue by URL
    const urls = [];
    for (const f of files.slice(0, 20)) {
      const data = f.buffer; // from memoryStorage
      const uploaded = await uploadBufferAdmin({ buffer: data, contentType: f.mimetype || 'image/png', pathPrefix: 'uploads' });
      if (uploaded?.url) urls.push(uploaded.url);
    }

    if (!urls.length) return res.status(400).json({ error: 'Failed to upload files' });

    const jobs = urls.map((u, idx) => ({
      user_id: userId,
      original_url: u,
      provider: 'removebg',
      options: { background, overlayLogo: idx === 0, outputFormat: 'png' },
    }));

    const { data, error } = await supabase.from('image_processing_jobs').insert(jobs).select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ queued: data.map(r => r.id) });
  } catch (err) {
    console.error('enqueueFromUpload error:', err);
    return res.status(500).json({ error: 'Failed to enqueue uploads', details: err.message });
  }
};

// Download processed image with attachment headers
exports.downloadResult = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const id = req.params?.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { data, error } = await supabase
      .from('image_processing_jobs')
      .select('result_url, status')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error) return res.status(404).json({ error: 'Job not found' });
    if (!data?.result_url) return res.status(400).json({ error: 'Result not available yet' });

    const upstream = await axios.get(data.result_url, { responseType: 'stream', validateStatus: () => true });
    if (upstream.status < 200 || upstream.status >= 300) {
      return res.status(502).json({ error: 'Failed to fetch file', status: upstream.status });
    }
    const ct = upstream.headers['content-type'] || 'application/octet-stream';
    let ext = 'png';
    if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
    else if (ct.includes('webp')) ext = 'webp';
    else if (ct.includes('png')) ext = 'png';
    const filename = `processed-${id}.${ext}`;

    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    upstream.data.pipe(res);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to download' });
  }
};

// Batch download processed jobs by ids (comma-separated ids=...)
exports.downloadAll = async (req, res) => {
  try {
    const authRes = await getUserFromRequest(req, { setSession: true, allowRefresh: true });
    if (authRes.error) return res.status(authRes.error.status || 401).json({ error: authRes.error.message });
    const userId = authRes.user.id;
    const idsParam = (req.query?.ids || '').toString();
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
    if (!ids.length) return res.status(400).json({ error: 'ids required' });

    const { data, error } = await supabase
      .from('image_processing_jobs')
      .select('id, result_url, status')
      .in('id', ids)
      .eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });

    const rows = (data || []).filter(r => r.result_url && r.status === 'success');
    if (!rows.length) return res.status(400).json({ error: 'No completed results found' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="processed-images.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { try { res.status(500).end(); } catch {} });
    archive.pipe(res);

    for (const row of rows) {
      const upstream = await axios.get(row.result_url, { responseType: 'stream', validateStatus: () => true });
      if (upstream.status >= 200 && upstream.status < 300) {
        const ct = upstream.headers['content-type'] || 'image/png';
        let ext = 'png';
        if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
        else if (ct.includes('webp')) ext = 'webp';
        const filename = `processed-${row.id}.${ext}`;
        archive.append(upstream.data, { name: filename });
      }
    }

    archive.finalize();
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to download all' });
  }
};


