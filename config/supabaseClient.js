const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Use ANON key for standard server-side operations with RLS (paired with setSession per request)
// Service role should only be used via supabaseAdmin where elevated access is required
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log('Supabase client initialized:', {
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY ? 'Set' : 'Missing',
});

module.exports = supabase;