const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { rateLimit } = require('../middleware/rateLimit');
const { captchaRequired } = require('../middleware/captcha');
const { sameOrigin } = require('../middleware/sameOrigin');

router.post('/signup', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);    
router.post('/admin/invite', authController.inviteUser);
// Apply conservative limits to sensitive endpoints
router.post(
  '/forgot-password',
  rateLimit({ windowMs: 60_000, max: 5 }),
  captchaRequired(),
  sameOrigin(process.env.NODE_ENV === 'production'),
  authController.forgotPassword
);
router.post(
  '/set-password',
  rateLimit({ windowMs: 60_000, max: 10 }),
  sameOrigin(process.env.NODE_ENV === 'production'),
  authController.setPassword
);
router.post(
  '/change-password',
  rateLimit({ windowMs: 60_000, max: 10 }),
  sameOrigin(process.env.NODE_ENV === 'production'),
  authController.changePassword
);

module.exports = router;