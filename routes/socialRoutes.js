const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');
const supabaseAuth = require('../middleware/supabaseAuth');
const { runOnce } = require('../worker/socialPoster');

router.get('/fb/login-url', socialController.getFbLoginUrl);
router.get('/fb/callback', socialController.fbCallback);

// Protect these routes with auth middleware if you want:
router.get('/social-accounts', socialController.getSocialAccounts);
router.get('/social-accounts-by-email', socialController.getSocialAccountsByEmail);

module.exports = router;

// Ad-hoc route to process queued social posts (protected)
router.post('/social/jobs/run-once', supabaseAuth, async (req, res) => {
  try {
    const result = await runOnce(10);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to run jobs' });
  }
});
