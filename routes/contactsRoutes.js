const express = require('express');
const router = express.Router();
const controller = require('../controllers/contactsController');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');
const { requireTierOrAbove } = require('../middleware/tier');

router.get('/contacts', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('basic')(req, res, next), controller.list);
router.get('/contacts/export', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.exportAll);
router.post('/contacts/bulk-delete', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('basic')(req, res, next), controller.bulkDelete);
router.get('/contacts/:id', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('basic')(req, res, next), controller.getDetail);
router.patch('/contacts/:id', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('basic')(req, res, next), controller.update);
router.post('/contacts/:id/notes', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('basic')(req, res, next), controller.addNote);

module.exports = router;


