require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const socialRoutes = require('./routes/socialRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const mobileDeRoutes = require('./routes/mobiledeRoutes');
const adsRoutes = require('./routes/adsRoutes');
const appsRoutes = require('./routes/appsRoutes');
const emailRoutes = require('./routes/emailRoutes');
const imageRoutes = require('./routes/imageRoutes');
const contactsRoutes = require('./routes/contactsRoutes');
const calendarRoutes = require('./routes/calendarRoutes');
const adminRoutes = require('./routes/adminRoutes');
const supportRoutes = require('./routes/supportRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const creditsRoutes = require('./routes/creditsRoutes');
const paymentController = require('./controllers/paymentController');
const { runOnce: runImageWorkerOnce } = require('./worker/imageProcessor');


const app = express();
// Disable ETag to avoid 304 on dynamic API responses
app.set('etag', false);
app.use(cors());
// Stripe webhook must be defined before express.json so body isn't parsed
// const paymentController = require('./controllers/paymentController');
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), paymentController.stripeWebhook);
app.use(express.json());
// Ensure API responses are not cached by intermediaries/browsers
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Vary', 'Authorization');
  next();
});

// Stripe webhook must use raw body for signature verification
// app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), paymentController.stripeWebhook);

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.path}`, {
    headers: {
      authorization: req.headers.authorization ? `Bearer ${req.headers.authorization.split(' ')[1]?.substring(0, 20)}...` : 'None',
      'x-refresh-token': req.headers['x-refresh-token'] ? 'Present' : 'None',
      'user-agent': req.headers['user-agent']?.substring(0, 50) || 'None'
    },
    query: req.query,
    bodyKeys: Object.keys(req.body || {})
  });
  next();
});

app.use('/api', authRoutes);
app.use('/api', socialRoutes);
app.use('/api', paymentRoutes);
app.use('/api', mobileDeRoutes);
app.use('/api', adsRoutes);
app.use('/api', appsRoutes);
app.use('/api', adminRoutes);
app.use('/api', supportRoutes);
app.use('/api', whatsappRoutes);
app.use('/api', emailRoutes);
app.use('/api', contactsRoutes);
app.use('/api', calendarRoutes);
app.use('/api', imageRoutes);
app.use('/api', settingsRoutes);
app.use('/api', creditsRoutes);

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Inline worker loop (optional). Avoids separate Render service.
// Set RUN_INLINE_WORKER=true to enable. Uses an in-memory lock to avoid overlap.
if (process.env.RUN_INLINE_WORKER === 'true') {
  let busy = false;
  const intervalMs = parseInt(process.env.INLINE_WORKER_INTERVAL_MS || process.env.IMAGE_WORKER_INTERVAL_MS || '4000', 10);
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const batch = parseInt(process.env.IMAGE_WORKER_BATCH || '3', 10);
      await runImageWorkerOnce(batch);
    } catch (_) {}
    busy = false;
  }, intervalMs);
}