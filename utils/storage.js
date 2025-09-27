const supabase = require('../config/supabaseClient');
const { v4: uuidv4 } = require('uuid');

const BUCKET = process.env.SUPABASE_BUCKET || 'public';

async function uploadBuffer({ buffer, contentType = 'image/png', pathPrefix = 'processed' }) {
  const id = uuidv4();
  const path = `${pathPrefix}/${id}`;
  const { data, error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  const { data: pub } = await supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: pub?.publicUrl };
}

module.exports = { uploadBuffer };

