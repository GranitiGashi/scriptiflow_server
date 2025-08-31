const express = require('express');
const router = express.Router();
const controller = require('../controllers/supportController');

router.post('/support/tickets', controller.createTicket);
router.get('/support/tickets', controller.listMyTickets);
router.get('/admin/support/tickets', controller.listAllTickets);

module.exports = router;


