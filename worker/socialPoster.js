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
    } catch (e) {}
  }

  // Create post
  if (mediaFbids.length > 1) {
    const attached_media = mediaFbids.map((id) => ({ media_fbid: id }));
    const res = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, null, {
      params: { message: caption || '', attached_media: JSON.stringify(attached_media), access_token: token },
    });
    return res.data;
  } else {
    const params = { message: caption || '', access_token: token };
    if (mediaFbids[0]) params.object_attachment = mediaFbids[0];
    const res = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, null, { params });
    return res.data;
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

  if (imgs.length <= 1) {
    // Single image
    const media = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media`, null, {
      params: { image_url: imgs[0], caption: caption || '', access_token: token },
    });
    const creation_id = media.data?.id;
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

  const carousel = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media`, null, {
    params: { media_type: 'CAROUSEL', children: children.join(','), caption: caption || '', access_token: token },
  });
  const creation_id = carousel.data?.id;
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
      let result;
      if (job.platform === 'facebook') {
        result = await postToFacebook({ user_id: job.user_id, caption, images });
      } else if (job.platform === 'instagram') {
        result = await postToInstagram({ user_id: job.user_id, caption, images });
      }
      await supabase.from('social_post_jobs').update({ status: 'success', error: null, updated_at: new Date().toISOString() }).eq('id', job.id);
      processed += 1;
    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
      await supabase.from('social_post_jobs').update({ status: job.attempts + 1 >= 3 ? 'failed' : 'queued', error: msg, updated_at: new Date().toISOString() }).eq('id', job.id);
    }
  }
  return { processed };
}

module.exports = { runOnce };


