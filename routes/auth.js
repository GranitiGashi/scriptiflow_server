const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/signup', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);    
router.post('/admin/invite', authController.inviteUser);
router.post('/forgot-password', authController.forgotPassword);
router.post('/set-password', authController.setPassword);
router.post('/change-password', authController.changePassword);

module.exports = router;