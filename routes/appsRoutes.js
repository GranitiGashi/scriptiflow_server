const express = require('express');
const router = express.Router();
const appsController = require('../controllers/appsController');

// Get apps for current authenticated user (admin-assigned apps)
router.get('/user/apps', appsController.getUserApps);

module.exports = router;


