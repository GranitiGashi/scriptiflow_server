// workers/testAutoPosting.js
const { checkForNewCarsAndPost } = require('../controllers/mobiledeController');

// Test auto-posting for a specific user
async function testAutoPosting(userId) {
  console.log('🧪 Testing Auto-Posting for User:', userId);
  console.log('Timestamp:', new Date().toISOString());
  console.log('---');
  
  try {
    const result = await checkForNewCarsAndPost(userId);
    
    console.log('📊 Results:');
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
    
  } catch (err) {
    console.error('💥 Test failed:', err);
  }
  
  console.log('---');
  console.log('✅ Test completed');
}

// Get user ID from command line argument
const userId = process.argv[2];

if (!userId) {
  console.error('❌ Please provide a user ID');
  console.log('Usage: node workers/testAutoPosting.js <user_id>');
  process.exit(1);
}

testAutoPosting(userId)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
