// routes/mobileDeRoutes.js
const express = require('express');
const router = express.Router();
const mobiledeController = require('../controllers/mobiledeController');

router.post('/connect-mobile-de', mobiledeController.connectMobile);
router.get('/connect-mobile-de', mobiledeController.getMobileCredentials);
router.put('/connect-mobile-de', mobiledeController.editMobileCredentials);
router.delete('/connect-mobile-de', mobiledeController.deleteMobileCredentials);
router.get('/get-user-cars', mobiledeController.getUserCars);
router.post('/mobilede/sync-now', mobiledeController.syncMobileDe);
router.get('/mobilede/status', mobiledeController.getMobileDeStatus);
router.get('/mobilede/listings', mobiledeController.getMobileDeListings);
router.post('/mobilede/seed-dummy', mobiledeController.seedDummyListing);

module.exports = router;