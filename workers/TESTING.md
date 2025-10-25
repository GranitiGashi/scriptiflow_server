# Auto-Posting Worker Testing Guide

## 🧪 **Testing Methods**

### **1. Local Testing (Start Here)**

#### **Test All Users:**
```bash
cd scriptiflow_server
npm run test-worker
```

#### **Test Specific User:**
```bash
cd scriptiflow_server
npm run test-user <user_id>
# Example: npm run test-user 123e4567-e89b-12d3-a456-426614174000
```

#### **Run Worker Locally:**
```bash
cd scriptiflow_server
npm run worker
```

### **2. Environment Setup**

#### **Required Environment Variables:**
```bash
NODE_ENV=development
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

#### **Create .env file:**
```bash
# In scriptiflow_server/.env
NODE_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### **3. Test Scenarios**

#### **Scenario 1: No Users with Credentials**
- **Expected**: `users_processed: 0`
- **Test**: Run with no mobile.de credentials in database

#### **Scenario 2: Users with Credentials but No New Cars**
- **Expected**: `new_posts: 0`, `total_checked: X`
- **Test**: Run with users who have credentials but no new cars

#### **Scenario 3: Users with New Cars**
- **Expected**: `new_posts: > 0`, posts created in database
- **Test**: Run with users who have new cars on mobile.de

#### **Scenario 4: Field Comparison Testing**
- **Expected**: Detailed logging of field comparison
- **Test**: Run `npm run test-fields <user_id>` to see field comparison logic

#### **Scenario 5: API Errors**
- **Expected**: Error handling, graceful failure
- **Test**: Run with invalid mobile.de credentials

### **4. Manual Testing Steps**

#### **Step 1: Check Database**
```sql
-- Check if users have mobile.de credentials
SELECT user_id, username, first_connected_at, last_sync_at 
FROM mobile_de_credentials 
WHERE provider = 'mobile_de' 
AND deleted_at IS NULL;
```

#### **Step 2: Check Social Post Jobs**
```sql
-- Check if posts are being created
SELECT user_id, platform, mobile_ad_id, created_at 
FROM social_post_jobs 
ORDER BY created_at DESC 
LIMIT 10;
```

#### **Step 3: Check Mobile.de Listings**
```sql
-- Check if listings are being stored
SELECT user_id, mobile_ad_id, first_seen, last_seen 
FROM mobile_de_listings 
ORDER BY first_seen DESC 
LIMIT 10;
```

### **5. Health Check Testing**

#### **Start Worker with Health Endpoints:**
```bash
cd scriptiflow_server
npm run worker
```

#### **Test Health Endpoints:**
```bash
# Health check
curl http://localhost:3001/health

# Status check
curl http://localhost:3001/status

# Manual trigger
curl -X POST http://localhost:3001/trigger
```

### **6. Expected Output**

#### **Successful Test Output:**
```
🧪 Testing Auto-Posting Worker
Timestamp: 2024-01-15T10:30:00.000Z
---
📊 Test Results:
  Success: true
  Users Processed: 3
  New Posts: 5
  Total Posts Created: 10

📋 Individual User Results:
  User 1: 123e4567-e89b-12d3-a456-426614174000
    Success: true
    New Posts: 2
  User 2: 456e7890-e89b-12d3-a456-426614174001
    Success: true
    New Posts: 3
---
✅ Test completed
```

#### **Error Test Output:**
```
🧪 Testing Auto-Posting Worker
Timestamp: 2024-01-15T10:30:00.000Z
---
📊 Test Results:
  Success: false
  Users Processed: 0
  New Posts: 0
  Error: No credentials found
---
✅ Test completed
```

### **7. Debugging Tips**

#### **Check Logs:**
- Look for `✅ Auto-posting completed successfully`
- Look for `❌ Auto-posting failed`
- Check individual user results

#### **Common Issues:**
1. **No credentials**: User hasn't connected mobile.de
2. **API errors**: Invalid mobile.de credentials
3. **Database errors**: Supabase connection issues
4. **Rate limiting**: Too many API calls

#### **Debug Commands:**
```bash
# Check if worker is running
ps aux | grep node

# Check worker logs
tail -f logs/worker.log

# Test specific user
npm run test-user <user_id>
```

### **8. Production Testing**

#### **Before Deploying:**
1. ✅ Test locally with real data
2. ✅ Verify all users are processed
3. ✅ Check database for new posts
4. ✅ Test health endpoints
5. ✅ Verify error handling

#### **After Deploying:**
1. ✅ Check Render logs
2. ✅ Test health endpoint: `https://your-worker.onrender.com/health`
3. ✅ Monitor for 24 hours
4. ✅ Check database for new posts

### **9. Monitoring in Production**

#### **Health Endpoint:**
```bash
curl https://your-worker.onrender.com/health
```

#### **Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "nextRun": "2024-01-15T10:35:00.000Z",
  "isJobRunning": false,
  "lastRunTime": "2024-01-15T10:30:00.000Z",
  "totalRuns": 12,
  "totalNewPosts": 5,
  "uptime": 3600
}
```

### **10. Troubleshooting**

#### **Worker Not Starting:**
- Check environment variables
- Verify Supabase connection
- Check logs for errors

#### **No Posts Being Created:**
- Check if users have mobile.de credentials
- Verify mobile.de API access
- Check for new cars on mobile.de

#### **Health Endpoint Not Responding:**
- Check if worker is running
- Verify port configuration
- Check Render service status
