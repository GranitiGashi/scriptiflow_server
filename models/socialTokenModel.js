const supabase = require('../config/supabaseClient');
const supabaseAdmin = require('../config/supabaseAdmin');

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
  console.log('🔍 [getFacebookUserToken] Looking up Facebook token for user:', user_id);
  
  // Primary: try with standard client (RLS-enabled)
  try {
    console.log('🔍 [getFacebookUserToken] Trying with standard RLS client...');
    const { data, error } = await supabase
      .from('user_social_tokens')
      .select('access_token, metadata, provider, token_type, created_at, expires_at')
      .eq('user_id', user_id)
      .eq('provider', 'facebook')
      .eq('token_type', 'user')
      .maybeSingle();
      
    console.log('🔍 [getFacebookUserToken] Standard client result:', {
      data: data ? { hasToken: !!data.access_token, tokenLength: data.access_token?.length, provider: data.provider, created_at: data.created_at } : null,
      error: error?.message || null
    });
    
    if (error) throw error;
    if (data) {
      console.log('✅ [getFacebookUserToken] Found token with standard client');
      return data;
    }
  } catch (e) {
    console.log('⚠️ [getFacebookUserToken] Standard client failed:', e.message);
    // fallthrough to admin
  }

  console.log('🔍 [getFacebookUserToken] Trying with admin client (strict)...');
  // Fallback: use admin client to bypass RLS and be more tolerant
  const { data: strict, error: strictErr } = await supabaseAdmin
    .from('user_social_tokens')
    .select('access_token, metadata, provider, token_type, created_at, expires_at')
    .eq('user_id', user_id)
    .eq('provider', 'facebook')
    .eq('token_type', 'user')
    .maybeSingle();
    
  console.log('🔍 [getFacebookUserToken] Admin client (strict) result:', {
    data: strict ? { hasToken: !!strict.access_token, tokenLength: strict.access_token?.length, provider: strict.provider, created_at: strict.created_at } : null,
    error: strictErr?.message || null
  });
  
  if (strictErr) throw strictErr;
  if (strict) {
    console.log('✅ [getFacebookUserToken] Found token with admin client (strict)');
    return strict;
  }

  console.log('🔍 [getFacebookUserToken] Trying with admin client (any Facebook token)...');
  
  // Debug: First check if admin client can read the table at all
  try {
    const { data: testQuery, error: testError } = await supabaseAdmin
      .from('user_social_tokens')
      .select('user_id, provider, token_type')
      .limit(1);
    console.log('🔍 [getFacebookUserToken] Admin client table access test:', {
      canReadTable: !testError,
      error: testError?.message || null,
      recordCount: testQuery?.length || 0
    });
  } catch (testErr) {
    console.log('❌ [getFacebookUserToken] Admin client table access failed:', testErr.message);
  }
  
  // Last resort: any facebook token for this user
  const { data: anyFb, error: anyErr } = await supabaseAdmin
    .from('user_social_tokens')
    .select('access_token, metadata, provider, token_type, created_at, expires_at')
    .eq('user_id', user_id)
    .eq('provider', 'facebook')
    .maybeSingle();
    
  console.log('🔍 [getFacebookUserToken] Admin client (any) result:', {
    data: anyFb ? { hasToken: !!anyFb.access_token, tokenLength: anyFb.access_token?.length, provider: anyFb.provider, token_type: anyFb.token_type, created_at: anyFb.created_at } : null,
    error: anyErr?.message || null
  });
  
  if (anyErr) throw anyErr;
  
  if (anyFb) {
    console.log('✅ [getFacebookUserToken] Found token with admin client (any)');
  } else {
    console.log('❌ [getFacebookUserToken] No Facebook token found for user:', user_id);
    
    // Debug: Let's see what tokens exist for this user
    try {
      const { data: allTokens, error: allErr } = await supabaseAdmin
        .from('user_social_tokens')
        .select('provider, token_type, created_at, expires_at')
        .eq('user_id', user_id);
      
      console.log('🔍 [getFacebookUserToken] All tokens for user:', user_id, {
        tokens: allTokens || [],
        error: allErr?.message || null
      });
    } catch (debugErr) {
      console.log('⚠️ [getFacebookUserToken] Debug query failed:', debugErr.message);
    }
    
    // Last resort: Direct SQL query to bypass any RLS issues
    console.log('🔍 [getFacebookUserToken] Trying direct SQL query...');
    try {
      const { data: sqlResult, error: sqlError } = await supabaseAdmin.rpc('get_user_facebook_token', {
        p_user_id: user_id
      });
      
      if (!sqlError && sqlResult && sqlResult.length > 0) {
        const token = sqlResult[0];
        console.log('✅ [getFacebookUserToken] Found token via direct SQL:', {
          hasToken: !!token.access_token,
          tokenLength: token.access_token?.length || 0
        });
        return {
          access_token: token.access_token,
          metadata: token.metadata,
          provider: token.provider,
          token_type: token.token_type,
          created_at: token.created_at,
          expires_at: token.expires_at
        };
      }
    } catch (sqlErr) {
      console.log('⚠️ [getFacebookUserToken] Direct SQL query failed (function may not exist):', sqlErr.message);
    }
  }
  
  return anyFb || null;
}

module.exports = { upsertFacebookUserToken, getFacebookUserToken };


