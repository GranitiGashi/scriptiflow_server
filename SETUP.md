# Scriptiflow Server Setup Guide

## Environment Variables Configuration

To fix the "Forbidden: cross-origin request blocked" error and ensure the forgot password feature works correctly, you **must** configure the following environment variables:

### Required Environment Variables

Create a `.env` file in the `scriptiflow_server` directory with the following variables:

```bash
# Server Configuration
PORT=8081
NODE_ENV=production

# Frontend URL - CRITICAL FOR CORS AND SECURITY
# This MUST match your actual frontend URL exactly
FRONTEND_URL=http://localhost:3000
# For production:
# FRONTEND_URL=https://yourdomain.com

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_JWT_SECRET=your_supabase_jwt_secret

# Email Configuration (Required for password reset emails)
EMAIL_FROM=noreply@yourdomain.com
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_specific_password
```

### Optional Environment Variables

```bash
# CAPTCHA (optional - leave empty to disable)
CAPTCHA_PROVIDER=recaptcha
CAPTCHA_SECRET=your_captcha_secret

# State Token Secret (optional - adds extra security)
STATE_TOKEN_SECRET=your_random_secret_key

# Stripe (optional - only if using payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Worker Configuration (optional)
RUN_INLINE_WORKER=false
INLINE_WORKER_INTERVAL_MS=4000
IMAGE_WORKER_BATCH=3
SOCIAL_WORKER_BATCH=5
```

## Common Issues and Solutions

### 1. "Forbidden: cross-origin request blocked" Error

**Cause**: The `FRONTEND_URL` environment variable doesn't match your actual frontend URL.

**Solution**: 
- Check your frontend URL (e.g., `http://localhost:3000` for development)
- Set `FRONTEND_URL` in your server's `.env` file to match exactly
- Restart your server after making changes

**Example for local development:**
```bash
FRONTEND_URL=http://localhost:3000
```

**Example for production:**
```bash
FRONTEND_URL=https://app.yourdomain.com
```

### 2. Password Reset Email Not Sending

**Cause**: Email configuration is missing or incorrect.

**Solution**:
- Configure the `EMAIL_*` variables in your `.env` file
- For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833)
- Test your email configuration

### 3. CAPTCHA Verification Failed

**Cause**: CAPTCHA is enabled but not configured on frontend.

**Solution**:
- Either configure CAPTCHA on both frontend and backend
- OR disable it by removing `CAPTCHA_PROVIDER` and `CAPTCHA_SECRET` from `.env`

## Frontend Configuration

Make sure your frontend has the correct backend URL configured:

In `scriptiflow/.env.local`:
```bash
NEXT_PUBLIC_BASE_DOMAIN=http://localhost:8081
# For production:
# NEXT_PUBLIC_BASE_DOMAIN=https://api.yourdomain.com
```

## Testing the Fix

1. Start your backend server:
   ```bash
   cd scriptiflow_server
   npm start
   ```

2. Start your frontend:
   ```bash
   cd scriptiflow
   npm run dev
   ```

3. Navigate to the forgot password page
4. Enter an email and submit
5. Check that you receive the password reset email

## Development vs Production

### Development Settings
```bash
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### Production Settings
```bash
NODE_ENV=production
FRONTEND_URL=https://yourdomain.com
```

**Important**: The `sameOrigin` middleware is enforced in production mode. Make sure your `FRONTEND_URL` is set correctly!

## Additional Security Notes

- The forgot password endpoint has rate limiting (5 requests per minute)
- The endpoint uses the `sameOrigin` middleware to prevent CSRF attacks
- CAPTCHA can be enabled for additional security (optional)
- State tokens provide an additional layer of security against link tampering

## Need Help?

If you're still experiencing issues:

1. Check server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure your frontend and backend URLs match the configuration
4. Clear browser cache and cookies
5. Try testing in an incognito/private browser window

