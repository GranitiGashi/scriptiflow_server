const express = require('express');
const router = express.Router();
const controller = require('../controllers/emailController');
const { requireSupabaseAuth, requireAdminRole } = require('../middleware/supabaseAuth');
const { requireTierOrAbove } = require('../middleware/tier');

// Status and connect/disconnect
router.get('/email/status', requireSupabaseAuth, controller.getStatus);
router.delete('/email/disconnect', requireSupabaseAuth, controller.disconnect);

// Gmail OAuth
router.get('/email/gmail/login-url', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.getGmailLoginUrl);
router.get('/email/gmail/callback', controller.gmailCallback);

// Outlook OAuth
router.get('/email/outlook/login-url', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.getOutlookLoginUrl);
router.get('/email/outlook/callback', controller.outlookCallback);

// Leads list and reply
router.get('/email/leads', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.listLeads);
router.post('/email/reply', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.reply);

// Manual fetch trigger (authenticated)
router.post('/email/fetch-now', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.fetchNow);

// Cron/ops: run once for all connected users (admin-only)
const { runOnce } = require('../worker/emailFetcher');
router.post('/email/jobs/run-once', requireSupabaseAuth, requireAdminRole, async (req, res) => {
  try {
    const result = await runOnce(50);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to run job' });
  }
});

module.exports = router;


