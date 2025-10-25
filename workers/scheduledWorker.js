// workers/scheduledWorker.js
const cron = require('node-cron');
const { runAutoPostingForAllUsers } = require('../controllers/mobiledeController');

console.log('🕐 Scheduled Auto-Posting Worker Started');
console.log('Timestamp:', new Date().toISOString());
console.log('Environment:', process.env.NODE_ENV || 'development');

// Track if a job is currently running
let isJobRunning = false;

// Function to run the auto-posting job
async function runAutoPostingJob() {
  if (isJobRunning) {
    console.log('⏸️ Job already running, skipping this execution');
    return;
  }

  isJobRunning = true;
  console.log('⏰ Running scheduled auto-posting check...');
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    const result = await runAutoPostingForAllUsers();
    
    if (result.success) {
      console.log('✅ Auto-posting completed successfully');
      console.log(`📊 Users processed: ${result.users_processed}`);
      console.log(`📈 Total new posts: ${result.total_new_posts}`);
      
      // Log individual results if available
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
    console.error('💥 Scheduled auto-posting failed:', err);
  } finally {
    isJobRunning = false;
    console.log('⏰ Scheduled check completed\n');
  }
}

// Run every hour at minute 0
cron.schedule('0 * * * *', runAutoPostingJob, {
  scheduled: true,
  timezone: "UTC"
});

// Run immediately on startup (for testing)
if (process.env.RUN_ON_STARTUP === 'true') {
  console.log('🚀 Running auto-posting on startup...');
  setTimeout(runAutoPostingJob, 5000); // Wait 5 seconds after startup
}

// Keep the process alive
console.log('🔄 Worker is running and will check every hour...');
console.log('Next check scheduled for:', new Date(Date.now() + 60 * 60 * 1000).toISOString());

// Health check function
function healthCheck() {
  const now = new Date();
  const nextRun = new Date(now.getTime() + (60 - now.getMinutes()) * 60 * 1000);
  
  return {
    status: 'healthy',
    timestamp: now.toISOString(),
    nextRun: nextRun.toISOString(),
    isJobRunning: isJobRunning,
    uptime: process.uptime()
  };
}

// Log health status every 10 minutes
setInterval(() => {
  const health = healthCheck();
  console.log('💓 Health check:', JSON.stringify(health, null, 2));
}, 10 * 60 * 1000);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  if (isJobRunning) {
    console.log('⏳ Waiting for current job to complete...');
    // Wait up to 30 seconds for job to complete
    setTimeout(() => {
      console.log('🛑 Forcing shutdown after timeout');
      process.exit(0);
    }, 30000);
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  if (isJobRunning) {
    console.log('⏳ Waiting for current job to complete...');
    setTimeout(() => {
      console.log('🛑 Forcing shutdown after timeout');
      process.exit(0);
    }, 30000);
  } else {
    process.exit(0);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
