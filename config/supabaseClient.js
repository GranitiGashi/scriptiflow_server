const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
console.log('Supabase client initialized:', {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY ? 'Set' : 'Missing',
});

module.exports = supabase;