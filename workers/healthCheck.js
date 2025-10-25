// workers/healthCheck.js
const express = require('express');
const app = express();
const cron = require('node-cron');
const { runAutoPostingForAllUsers } = require('../controllers/mobiledeController');

const PORT = process.env.PORT || 3001;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'auto-posting-worker'
  });
});

// Manual trigger endpoint
app.post('/trigger', async (req, res) => {
  try {
    console.log('🔄 Manual trigger requested');
    const result = await runAutoPostingForAllUsers();
    res.json(result);
  } catch (err) {
    console.error('Manual trigger failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    nextCheck: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    service: 'auto-posting-worker'
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

cron.schedule('0 * * * *', async () => {
  console.log('⏰ Running scheduled auto-posting check...');
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    const result = await runAutoPostingForAllUsers();
    
    if (result.success) {
      console.log('✅ Auto-posting completed successfully');
      console.log(`📊 Users processed: ${result.users_processed}`);
      console.log(`📈 Total new posts: ${result.total_new_posts}`);
    } else {
      console.error('❌ Auto-posting failed:', result.error);
    }
    
  } catch (err) {
    console.error('💥 Scheduled auto-posting failed:', err);
  }
  
  console.log('⏰ Scheduled check completed\n');
}, {
  scheduled: true,
  timezone: "UTC"
});

console.log('🔄 Worker is running and will check every hour...');
console.log('Next check scheduled for:', new Date(Date.now() + 60 * 60 * 1000).toISOString());

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});
