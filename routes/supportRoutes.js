const express = require('express');
const router = express.Router();
const controller = require('../controllers/supportController');

router.post('/support/tickets', controller.createTicket);
router.get('/support/tickets', controller.listMyTickets);
router.get('/admin/support/tickets', controller.listAllTickets);
router.post('/support/messages', controller.addMessage);
router.get('/support/messages', controller.listMessages);
router.post('/admin/support/status', controller.updateStatus);

module.exports = router;


