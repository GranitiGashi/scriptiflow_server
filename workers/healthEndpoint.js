// workers/healthEndpoint.js
const express = require('express');
const app = express();
const cron = require('node-cron');
const { runAutoPostingForAllUsers } = require('../controllers/mobiledeController');

const PORT = process.env.PORT || 3001;

// Track if a job is currently running
let isJobRunning = false;
let lastRunTime = null;
let lastRunResult = null;

// Function to run the auto-posting job
async function runAutoPostingJob() {
  if (isJobRunning) {
    console.log('⏸️ Job already running, skipping this execution');
    return;
  }

  isJobRunning = true;
  lastRunTime = new Date().toISOString();
  console.log('⏰ Running scheduled auto-posting check...');
  console.log('Timestamp:', lastRunTime);
  
  try {
    const result = await runAutoPostingForAllUsers();
    lastRunResult = result;
    
    if (result.success) {
      console.log('✅ Auto-posting completed successfully');
      console.log(`📊 Users processed: ${result.users_processed}`);
      console.log(`📈 Total new posts: ${result.total_new_posts}`);
    } else {
      console.error('❌ Auto-posting failed:', result.error);
    }
    
  } catch (err) {
    console.error('💥 Scheduled auto-posting failed:', err);
    lastRunResult = { success: false, error: err.message };
  } finally {
    isJobRunning = false;
    console.log('⏰ Scheduled check completed\n');
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  const now = new Date();
  const nextRun = new Date(now.getTime() + (60 - now.getMinutes()) * 60 * 1000);
  
  res.json({
    status: 'healthy',
    timestamp: now.toISOString(),
    nextRun: nextRun.toISOString(),
    isJobRunning: isJobRunning,
    lastRunTime: lastRunTime,
    lastRunResult: lastRunResult,
    uptime: process.uptime()
  });
});

// Manual trigger endpoint
app.post('/trigger', async (req, res) => {
  if (isJobRunning) {
    return res.status(409).json({ 
      error: 'Job already running',
      isJobRunning: true 
    });
  }

  try {
    console.log('🔄 Manual trigger requested');
    await runAutoPostingJob();
    res.json(lastRunResult);
  } catch (err) {
    console.error('Manual trigger failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Status endpoint
app.get('/status', (req, res) => {
  const now = new Date();
  const nextRun = new Date(now.getTime() + (60 - now.getMinutes()) * 60 * 1000);
  
  res.json({
    status: 'running',
    nextRun: nextRun.toISOString(),
    isJobRunning: isJobRunning,
    lastRunTime: lastRunTime,
    lastRunResult: lastRunResult,
    uptime: process.uptime()
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Auto-posting worker health server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔄 Manual trigger: POST http://localhost:${PORT}/trigger`);
});

// Schedule the auto-posting job
console.log('🕐 Setting up scheduled auto-posting...');

cron.schedule('0 * * * *', runAutoPostingJob, {
  scheduled: true,
  timezone: "UTC"
});

// Run immediately on startup if enabled
if (process.env.RUN_ON_STARTUP === 'true') {
  console.log('🚀 Running auto-posting on startup...');
  setTimeout(runAutoPostingJob, 5000);
}

console.log('🔄 Worker is running and will check every hour...');
console.log('Next check scheduled for:', new Date(Date.now() + 60 * 60 * 1000).toISOString());

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
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
