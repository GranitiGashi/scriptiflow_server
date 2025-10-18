const express = require('express');
const router = express.Router();
const controller = require('../controllers/supportController');
const upload = require('../middleware/upload');
const { requireSupabaseAuth, requireAdminRole } = require('../middleware/supabaseAuth');

router.post('/support/tickets', controller.createTicket);
router.get('/support/tickets', controller.listMyTickets);

// Admin-only support endpoints
router.use('/admin/support', requireSupabaseAuth, requireAdminRole);
router.get('/admin/support/tickets', controller.listAllTickets);
router.post('/admin/support/status', controller.updateStatus);

// Chat endpoints (auth handled inside controller)
router.post('/support/messages', upload.array('files', 5), controller.addMessage);
router.get('/support/messages', controller.listMessages);

module.exports = router;


