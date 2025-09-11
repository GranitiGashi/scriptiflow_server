const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireSupabaseAuth, requireAdminRole } = require('../middleware/supabaseAuth');

// Protect all admin routes: must be authenticated and have admin role
router.use('/admin', requireSupabaseAuth, requireAdminRole);

router.get('/admin/users', adminController.listUsers);
router.get('/admin/user-apps', adminController.listUserApps); // ?user_id={id}
router.post('/admin/user-apps', adminController.createUserApp);
router.delete('/admin/user-apps/:id', adminController.deleteUserApp);

module.exports = router;


