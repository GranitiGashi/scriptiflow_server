# Auto-Posting Worker

This worker automatically checks for new cars on mobile.de and creates social media posts every 5 minutes.

## How it works

1. **Connection Tracking**: When a user connects mobile.de, we save `first_connected_at` timestamp
2. **5-Minute Checks**: Every 5 minutes, we check for cars created after the last sync date
3. **Smart Filtering**: Only cars with `creationTime` after our sync date are processed
4. **Batch Processing**: Multiple new cars are processed efficiently
5. **Sync Updates**: After each check, we update the sync date

## Setup

### 1. Manual Testing
```bash
# Run the worker
npm run worker
```

### 2. Render Background Worker (Recommended)
1. Create a Background Worker service in Render
2. Set Build Command: `npm install`
3. Set Start Command: `npm run worker`
4. Add environment variables

### 3. Environment Variables
```bash
NODE_ENV=production
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
RUN_ON_STARTUP=false
```

## API Endpoints

### Health Check
```bash
GET /health
```

### Manual Trigger
```bash
POST /trigger
```

### Status Check
```bash
GET /status
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
- 📈 Total runs and posts created

## Error Handling

- **No credentials**: Skip user, log warning
- **API failures**: Continue with next user
- **Database errors**: Log error, continue processing
- **Rate limiting**: Built-in delays between API calls

## Performance

- **5-minute intervals**: Frequent checks for new cars
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
- Total runs and posts statistics
