const supabase = require('../config/supabaseClient');

// Upsert social record (insert or update)
async function upsertSocialRecord({ user_id, provider, account_id, access_token, metadata = {} }) {
  const { data: existing, error: fetchError } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', user_id)
    .eq('provider', provider)
    .eq('account_id', account_id)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    throw fetchError;
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('social_accounts')
      .update({
        access_token,
        metadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);

    if (updateError) throw updateError;
    return existing.id;
  } else {
    const { error: insertError } = await supabase.from('social_accounts').insert({
      user_id,
      provider,
      account_id,
      access_token,
      metadata,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (insertError) throw insertError;
  }
}

// Get all social accounts for a user by user_id
async function getSocialAccountsByUserId(user_id) {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', user_id);

  if (error) throw error;
  return data;
}

// Get user record by email
async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from('users_app')
    .select('*')
    .eq('email', email)
    .single();

  if (error) throw error;
  return data;
}

module.exports = { upsertSocialRecord, getSocialAccountsByUserId, getUserByEmail };