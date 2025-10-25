// workers/testFieldComparison.js
const { checkForNewCarsAndPost } = require('../controllers/mobiledeController');

// Get user ID from command line argument
const userId = process.argv[2];

if (!userId) {
  console.error('❌ Please provide a user ID');
  console.log('Usage: node workers/testFieldComparison.js <user_id>');
  console.log('Example: node workers/testFieldComparison.js 123e4567-e89b-12d3-a456-426614174000');
  process.exit(1);
}

async function testFieldComparison(userId) {
  console.log('🧪 Testing Field Comparison Logic');
  console.log('User ID:', userId);
  console.log('Timestamp:', new Date().toISOString());
  console.log('---');
  
  try {
    const result = await checkForNewCarsAndPost(userId);
    
    console.log('\n📊 Test Results:');
    console.log('  Success:', result.success);
    console.log('  New Posts:', result.new_posts || 0);
    console.log('  Total Checked:', result.total_checked || 0);
    console.log('  Posts Created:', result.posts_created || 0);
    
    if (result.error) {
      console.log('  Error:', result.error);
    }
    
    if (result.reason) {
      console.log('  Reason:', result.reason);
    }
    
    console.log('\n🔍 Field Comparison Logic:');
    console.log('  - Checks: ad.creationDate (from mobile.de API)');
    console.log('  - Compares with: last_sync_at || created_at (from database)');
    console.log('  - Only processes cars where: creationDate > last_sync_at');
    console.log('  - Updates last_sync_at to current time after check');
    
  } catch (err) {
    console.error('💥 Test failed:', err);
  }
  
  console.log('---');
  console.log('✅ Field comparison test completed');
}

testFieldComparison(userId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
