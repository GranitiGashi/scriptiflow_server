const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Get all users (admin only)
router.get('/users', adminController.getUsers);

// Get specific user's apps (admin only)
router.get('/users/:userId/apps', adminController.getUserApps);

// Create app for specific user (admin only)
router.post('/users/:userId/apps', adminController.createUserApp);

// Update user's app (admin only)
router.put('/users/:userId/apps/:appId', adminController.updateUserApp);

// Delete user's app (admin only)
router.delete('/users/:userId/apps/:appId', adminController.deleteUserApp);

module.exports = router;
