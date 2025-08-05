const supabase = require('../config/supabaseClient');

// Upsert social record (insert or update)
async function upsertSocialRecord({ user_id, provider, account_id, access_token, metadata = {}, token = null }) {
  // Check if record exists
  const { data: existing, error: fetchError } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', user_id)
    .eq('provider', provider)
    .eq('account_id', account_id)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') { // ignore "No rows" error
    throw fetchError;
  }

  if (existing) {
    // Update existing record
    const { error: updateError } = await supabase
      .from('social_accounts')
      .update({
        access_token,
        metadata,
        updated_at: new Date().toISOString(),
        token
      })
      .eq('id', existing.id);

    if (updateError) throw updateError;
    return existing.id;
  } else {
    // Insert new record
    const { error: insertError } = await supabase
      .from('social_accounts')
      .insert({
        user_id,
        provider,
        account_id,
        access_token,
        metadata,
        token,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
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

// Get user record by email (you may already have this)
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
    