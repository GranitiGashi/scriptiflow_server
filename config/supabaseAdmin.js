const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
console.log('Supabase Admin client initialized:', {
  url: process.env.SUPABASE_URL ? 'Set' : 'Missing',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set (service role)' : 'Missing (using anon key)',
  usingKey: serviceKey ? `${serviceKey.substring(0, 20)}...` : 'Missing'
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  serviceKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = supabaseAdmin;


