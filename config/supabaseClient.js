const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
console.log('Supabase client initialized:', {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE ? 'Set' : 'Missing', //changed from SUPABASE_KEY to SUPABASE_SERVICE_ROLE
});

module.exports = supabase;