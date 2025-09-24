const express = require('express');
const router = express.Router();
const controller = require('../controllers/calendarController');
const { requireSupabaseAuth } = require('../middleware/supabaseAuth');
const { requireTierOrAbove } = require('../middleware/tier');

router.get('/calendar/events', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.listEvents);
router.post('/calendar/events', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.createEvent);
router.put('/calendar/events/:id', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.updateEvent);
router.delete('/calendar/events/:id', requireSupabaseAuth, (req, res, next) => requireTierOrAbove('pro')(req, res, next), controller.deleteEvent);

module.exports = router;


