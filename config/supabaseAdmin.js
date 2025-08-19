const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  serviceKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = supabaseAdmin;


