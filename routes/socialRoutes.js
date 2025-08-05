const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');
const authMiddleware = require('../middleware/authenticateToken');

router.get('/fb/login-url', socialController.getFbLoginUrl);
router.get('/fb/callback', socialController.fbCallback);

// Protect these routes with auth middleware if you want:
router.get('/social-accounts', authMiddleware, socialController.getSocialAccounts);
router.get('/social-accounts-by-email', socialController.getSocialAccountsByEmail);

module.exports = router;
