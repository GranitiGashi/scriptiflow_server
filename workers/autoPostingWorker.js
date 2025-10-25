// workers/autoPostingWorker.js
const { runAutoPostingForAllUsers } = require('../controllers/mobiledeController');

// Run the auto-posting check for all users
async function runAutoPostingWorker() {
  console.log('=== Auto-Posting Worker Started ===');
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    const result = await runAutoPostingForAllUsers();
    
    if (result.success) {
      console.log('✅ Auto-posting completed successfully');
      console.log(`📊 Users processed: ${result.users_processed}`);
      console.log(`📈 Total new posts: ${result.total_new_posts}`);
      
      // Log individual results
      if (result.results && result.results.length > 0) {
        console.log('\n📋 Individual Results:');
        result.results.forEach(userResult => {
          if (userResult.success) {
            console.log(`  👤 User ${userResult.user_id}: ${userResult.new_posts || 0} new posts`);
          } else {
            console.log(`  ❌ User ${userResult.user_id}: ${userResult.error || 'Failed'}`);
          }
        });
      }
    } else {
      console.error('❌ Auto-posting failed:', result.error);
    }
    
  } catch (err) {
    console.error('💥 Auto-posting worker crashed:', err);
  }
  
  console.log('=== Auto-Posting Worker Finished ===\n');
}

// Run immediately if called directly
if (require.main === module) {
  runAutoPostingWorker()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Worker failed:', err);
      process.exit(1);
    });
}

module.exports = { runAutoPostingWorker };
