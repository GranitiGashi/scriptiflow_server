const express = require('express');
const router = express.Router();
const credits = require('../controllers/creditsController');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');

router.get('/credits/balance', requireSupabaseAuth, credits.getBalance);
router.post('/credits/top-up', requireSupabaseAuth, credits.topUp);

module.exports = router;


