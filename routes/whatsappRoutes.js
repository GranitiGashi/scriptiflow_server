const express = require('express');
const router = express.Router();
const controller = require('../controllers/whatsappController');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');
const { requireTierOrAbove } = require('../middleware/tier');

// Connect/disconnect credentials (pro+)
router.post('/whatsapp/connect', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.connectWhatsApp);
router.get('/whatsapp/credentials', requireSupabaseAuth, controller.getCredentials);
router.delete('/whatsapp/credentials', requireSupabaseAuth, controller.disconnect);
router.get('/whatsapp/phone-numbers', requireSupabaseAuth, controller.listPhoneNumbers);

// Webhook (public)
router.get('/whatsapp/webhook', controller.webhookVerify);
router.post('/whatsapp/webhook', controller.webhookReceive);

// Conversations + messages
router.get('/whatsapp/conversations', requireSupabaseAuth, controller.listConversations);
router.get('/whatsapp/messages', requireSupabaseAuth, controller.listMessages);
router.post('/whatsapp/send', requireSupabaseAuth, controller.sendMessage);
router.post('/whatsapp/mark-read', requireSupabaseAuth, controller.markRead);
router.post('/whatsapp/tag', requireSupabaseAuth, controller.setTag);

// Demo helpers (in-memory) for quick screencast
router.get('/whatsapp/demo/inbox', requireSupabaseAuth, controller.demoInbox);

module.exports = router;


