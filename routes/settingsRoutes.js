const express = require('express');
const router = express.Router();
const settings = require('../controllers/settingsController');
const upload = require('../middleware/upload');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

router.get('/settings/assets', requireSupabaseAuth, settings.getAssets);
router.post('/settings/assets', requireSupabaseAuth, upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'background', maxCount: 1 }]), settings.uploadAssets);

module.exports = router;


