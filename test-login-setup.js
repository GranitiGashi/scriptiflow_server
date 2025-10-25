#!/usr/bin/env node
/**
 * Test script to verify login setup
 * Run with: node test-login-setup.js
 */

require('dotenv').config();
const axios = require('axios');

const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FRONTEND_URL',
];

console.log('🔍 Checking Login Setup...\n');

// Check environment variables
console.log('1. Checking Environment Variables:');
let allEnvVarsPresent = true;
requiredEnvVars.forEach(varName => {
  const isPresent = !!process.env[varName];
  console.log(`   ${isPresent ? '✅' : '❌'} ${varName}: ${isPresent ? 'Set' : 'Missing'}`);
  if (!isPresent) allEnvVarsPresent = false;
});

if (!allEnvVarsPresent) {
  console.log('\n❌ Some required environment variables are missing!');
  console.log('   Please check your .env file in scriptiflow_server directory.\n');
  process.exit(1);
}

// Test Supabase connection
console.log('\n2. Testing Supabase Connection:');
(async () => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    
    // Try to query the users_app table
    const { data, error } = await supabase
      .from('users_app')
      .select('id')
      .limit(1);
    
    if (error && error.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is okay
      throw error;
    }
    
    console.log('   ✅ Supabase connection successful!');
  } catch (err) {
    console.log('   ❌ Supabase connection failed:', err.message);
    console.log('   Please verify your SUPABASE_URL and SUPABASE_ANON_KEY\n');
    process.exit(1);
  }
  
  // Check if server is running
  console.log('\n3. Checking if server is running:');
  const PORT = process.env.PORT || 8081;
  try {
    // Try to connect to localhost
    const response = await axios.get(`http://localhost:${PORT}/api/health`, {
      timeout: 2000,
      validateStatus: () => true, // Accept any status
    });
    console.log('   ✅ Server is running on port', PORT);
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log(`   ⚠️  Server is not running on port ${PORT}`);
      console.log('   Start it with: npm start or npm run dev\n');
    } else {
      console.log('   ℹ️  Could not check server status:', err.message);
    }
  }
  
  console.log('\n✅ Basic setup verification complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Make sure your frontend has NEXT_PUBLIC_BASE_DOMAIN set');
  console.log('   2. Start the backend: cd scriptiflow_server && npm start');
  console.log('   3. Start the frontend: cd scriptiflow && npm run dev');
  console.log('   4. Try logging in with a test account\n');
})();





