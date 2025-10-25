# Auto-Posting Worker

This worker automatically checks for new cars on mobile.de and creates social media posts.

## How it works

1. **Connection Tracking**: When a user connects mobile.de, we save `first_connected_at` timestamp
2. **Hourly Checks**: Every hour, we check for cars created after the last sync date
3. **Smart Filtering**: Only cars with `creationTime` after our sync date are processed
4. **Batch Processing**: Multiple new cars are processed efficiently
5. **Sync Updates**: After each check, we update the sync date

## Setup

### 1. Manual Testing
```bash
# Run the worker once
node workers/autoPostingWorker.js
```

### 2. Cron Job Setup (Linux/Mac)
```bash
# Edit crontab
crontab -e

# Add this line to run every hour
0 * * * * cd /path/to/scriptiflow_server && node workers/autoPostingWorker.js >> logs/auto-posting.log 2>&1
```

### 3. Windows Task Scheduler
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger to "Daily" with "Repeat task every: 1 hour"
4. Action: Start a program
5. Program: `node`
6. Arguments: `workers/autoPostingWorker.js`
7. Start in: `C:\path\to\scriptiflow_server`

### 4. PM2 Process Manager (Recommended)
```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'auto-posting-worker',
    script: 'workers/autoPostingWorker.js',
    cron_restart: '0 * * * *', // Every hour
    autorestart: false,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## API Endpoints

### Manual Trigger
```bash
POST /api/mobilede/trigger-auto-posting
Authorization: Bearer <token>
```

### Check Status
```bash
GET /api/mobilede/status
Authorization: Bearer <token>
```

## Database Schema

The system uses these fields in `mobile_de_credentials`:
- `first_connected_at`: When user first connected mobile.de
- `last_sync_at`: Last time we checked for new cars
- `last_sync_at` is updated after each check

## Logging

The worker logs:
- ✅ Successful operations
- ❌ Errors and failures
- 📊 Statistics (users processed, new posts)
- 📋 Individual user results

## Error Handling

- **No credentials**: Skip user, log warning
- **API failures**: Continue with next user
- **Database errors**: Log error, continue processing
- **Rate limiting**: Built-in delays between API calls

## Performance

- **Batch processing**: Multiple cars processed together
- **Efficient queries**: Only fetch recent listings
- **Smart filtering**: Only process truly new cars
- **Memory management**: Process users sequentially

## Monitoring

Check logs for:
- Worker execution times
- Number of new posts created
- API errors and retries
- Database connection issues
