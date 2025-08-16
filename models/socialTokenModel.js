const supabase = require('../config/supabaseClient');

// Table: user_social_tokens
// Columns: user_id (uuid, pk part), provider (text), token_type (text), access_token (text),
//          expires_at (timestamptz, nullable), metadata (jsonb), created_at, updated_at

async function upsertFacebookUserToken(user_id, access_token, metadata = {}) {
  const provider = 'facebook';
  const token_type = 'user';

  const { data: existing, error: fetchError } = await supabase
    .from('user_social_tokens')
    .select('user_id, provider, token_type')
    .eq('user_id', user_id)
    .eq('provider', provider)
    .eq('token_type', token_type)
    .maybeSingle();

  if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

  if (existing) {
    const { error: updateError } = await supabase
      .from('user_social_tokens')
      .update({ access_token, metadata, updated_at: new Date().toISOString() })
      .eq('user_id', user_id)
      .eq('provider', provider)
      .eq('token_type', token_type);
    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase.from('user_social_tokens').insert({
      user_id,
      provider,
      token_type,
      access_token,
      metadata,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;
  }
}

async function getFacebookUserToken(user_id) {
  const { data, error } = await supabase
    .from('user_social_tokens')
    .select('access_token, metadata')
    .eq('user_id', user_id)
    .eq('provider', 'facebook')
    .eq('token_type', 'user')
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = { upsertFacebookUserToken, getFacebookUserToken };


