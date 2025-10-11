const axios = require('axios');
const supabase = require('../config/supabaseClient');

async function postToFacebook({ user_id, caption, images }) {
  // Get page access token
  const { data: accounts, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', user_id)
    .eq('provider', 'facebook');
  if (error) throw error;
  const fb = Array.isArray(accounts) ? accounts[0] : null;
  if (!fb?.account_id || !fb?.access_token) throw new Error('Facebook account not connected');

  const pageId = fb.account_id;
  const token = fb.access_token;

  // Upload images -> media_fbid array
  const mediaFbids = [];
  for (const url of (images || []).slice(0, 10)) {
    try {
      const res = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/photos`, null, {
        params: { url, published: false, access_token: token },
      });
      if (res.data?.id) mediaFbids.push(res.data.id);
    } catch (e) {
      const m = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
      throw new Error(`FB photo upload failed: ${m}`);
    }
  }

  // Create post
  try {
    if (mediaFbids.length > 1) {
      // attached_media[0]={"media_fbid":ID}&attached_media[1]={"media_fbid":ID} ...
      const params = new URLSearchParams();
      params.set('message', caption || '');
      params.set('access_token', token);
      mediaFbids.forEach((id, idx) => params.set(`attached_media[${idx}]`, JSON.stringify({ media_fbid: id })));
      const res = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, params);
      return res.data;
    } else {
      const params = { message: caption || '', access_token: token };
      if (mediaFbids[0]) params.object_attachment = mediaFbids[0];
      const res = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, null, { params });
      return res.data;
    }
  } catch (e) {
    const m = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
    throw new Error(`FB post failed: ${m}`);
  }
}

async function postToInstagram({ user_id, caption, images }) {
  // Get instagram business account via social_accounts
  const { data: accounts, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', user_id)
    .eq('provider', 'instagram');
  if (error) throw error;
  const ig = Array.isArray(accounts) ? accounts[0] : null;
  if (!ig?.account_id || !ig?.access_token) throw new Error('Instagram account not connected');

  const igId = ig.account_id;
  const token = ig.access_token;
  const imgs = (images || []).slice(0, 10);

  // Helper: poll a media ID until status is FINISHED or timeout
  async function waitForMediaReady(creationId) {
    const start = Date.now();
    const timeoutMs = 90_000; // up to 90s
    const intervalMs = 2000;
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await axios.get(`https://graph.facebook.com/v19.0/${creationId}`, {
          params: { fields: 'status_code,status', access_token: token },
        });
        const s = (r.data?.status_code || r.data?.status || '').toString().toUpperCase();
        if (s === 'FINISHED') return true;
        if (s === 'ERROR') throw new Error(`IG media creation error: ${JSON.stringify(r.data)}`);
      } catch (e) {
        // keep polling unless hard error
      }
      await new Promise((res) => setTimeout(res, intervalMs));
    }
    throw new Error('IG media not ready before timeout');
  }

  if (imgs.length <= 1) {
    // Single image
    const media = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media`, null, {
      params: { image_url: imgs[0], caption: caption || '', access_token: token },
    });
    const creation_id = media.data?.id;
    await waitForMediaReady(creation_id);
    const publish = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media_publish`, null, {
      params: { creation_id, access_token: token },
    });
    return publish.data;
  }

  // Carousel: create children first
  const children = [];
  for (const url of imgs) {
    const m = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media`, null, {
      params: { image_url: url, is_carousel_item: true, access_token: token },
    });
    if (m.data?.id) children.push(m.data.id);
  }
  // Poll readiness of children
  for (const id of children) {
    await waitForMediaReady(id);
  }

  const carousel = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media`, null, {
    params: { media_type: 'CAROUSEL', children: children.join(','), caption: caption || '', access_token: token },
  });
  const creation_id = carousel.data?.id;
  await waitForMediaReady(creation_id);
  const publish = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media_publish`, null, {
    params: { creation_id, access_token: token },
  });
  return publish.data;
}

async function generateCaptionDE({ make, model }) {
  try {
    const openai = require('../utils/openaiClient');
    const prompt = `Schreibe eine kurze, freundliche Bildunterschrift auf Deutsch für ein Auto-Angebot. Marke: ${make}. Modell: ${model}. Maximal 20 Wörter. Keine Emojis.`;
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Du bist ein hilfreicher Marketing-Assistent für Autohäuser.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 80,
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    return text || `${make} ${model}`.trim();
  } catch (_) {
    return `${make} ${model}`.trim();
  }
}

async function runOnce(limit = 10) {
  const { data: jobs } = await supabase
    .from('social_post_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (!jobs || !jobs.length) return { processed: 0 };

  let processed = 0;
  for (const job of jobs) {
    try {
      await supabase.from('social_post_jobs').update({ status: 'posting', attempts: job.attempts + 1, updated_at: new Date().toISOString() }).eq('id', job.id);
      const make = job.payload?.make || job.payload?.details?.make || '';
      const model = job.payload?.model || job.payload?.details?.model || '';
      const captionBase = await generateCaptionDE({ make, model });
      const caption = job.payload?.caption ? `${job.payload.caption}\n\n${captionBase}` : captionBase;
      const images = Array.isArray(job.payload?.images) ? job.payload.images : (job.payload?.image_url ? [job.payload.image_url] : []);
      if (!images.length) throw new Error('No images provided');
      let result;
      if (job.platform === 'facebook') {
        result = await postToFacebook({ user_id: job.user_id, caption, images });
      } else if (job.platform === 'instagram') {
        result = await postToInstagram({ user_id: job.user_id, caption, images });
      } else {
        throw new Error(`Unsupported platform: ${job.platform}`);
      }
      await supabase.from('social_post_jobs').update({ status: 'success', error: null, updated_at: new Date().toISOString(), result: result || null }).eq('id', job.id);
      processed += 1;
    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
      const nextStatus = (job.attempts + 1) >= 3 ? 'failed' : 'queued';
      await supabase.from('social_post_jobs').update({ status: nextStatus, error: msg, updated_at: new Date().toISOString() }).eq('id', job.id);
    }
  }
  return { processed };
}

module.exports = { runOnce };


