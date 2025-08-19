const express = require('express');
const router = express.Router();
const userAppsController = require('../controllers/userAppsController');

// Get user's apps
router.get('/apps', userAppsController.getUserApps);

// Create or update user app
router.post('/apps', userAppsController.upsertUserApp);
router.put('/apps', userAppsController.upsertUserApp);

// Delete user app
router.delete('/apps/:id', userAppsController.deleteUserApp);

module.exports = router;
