
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://flrutigkqwbtpeobchkd.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE; // Use service role if you need admin-level permissions

const supabase = createClient(supabaseUrl, supabaseKey);

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

module.exports = supabase;
