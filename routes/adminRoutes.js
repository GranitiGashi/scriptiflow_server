const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Admin-only endpoints using Supabase session role check inside controller
router.get('/admin/users', adminController.listUsers);
router.get('/admin/user-apps', adminController.listUserApps); // ?user_id={id}
router.post('/admin/user-apps', adminController.createUserApp);
router.delete('/admin/user-apps/:id', adminController.deleteUserApp);

module.exports = router;


