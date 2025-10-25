// workers/testWorker.js
const { runAutoPostingForAllUsers } = require('../controllers/mobiledeController');

async function testWorker() {
  console.log('🧪 Testing Auto-Posting Worker');
  console.log('Timestamp:', new Date().toISOString());
  console.log('---');
  
  try {
    const result = await runAutoPostingForAllUsers();
    
    console.log('📊 Test Results:');
    console.log('  Success:', result.success);
    console.log('  Users Processed:', result.users_processed || 0);
    console.log('  New Posts:', result.total_new_posts || 0);
    console.log('  Total Posts Created:', result.posts_created || 0);
    
    if (result.error) {
      console.log('  Error:', result.error);
    }
    
    if (result.results && result.results.length > 0) {
      console.log('\n📋 Individual User Results:');
      result.results.forEach((userResult, index) => {
        console.log(`  User ${index + 1}: ${userResult.user_id}`);
        console.log(`    Success: ${userResult.success}`);
        if (userResult.success) {
          console.log(`    New Posts: ${userResult.new_posts || 0}`);
        } else {
          console.log(`    Error: ${userResult.error || 'Unknown error'}`);
        }
      });
    }
    
  } catch (err) {
    console.error('💥 Test failed:', err);
  }
  
  console.log('---');
  console.log('✅ Test completed');
}

// Run the test
testWorker()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
