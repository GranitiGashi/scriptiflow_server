const express = require('express');
const router = express.Router();
const as24 = require('../controllers/autoscout24Controller');

router.post('/autoscout24/connect', as24.connectAutoScout24);
router.get('/autoscout24/connect', as24.getAutoScout24Credentials);
router.put('/autoscout24/connect', as24.editAutoScout24Credentials);
router.delete('/autoscout24/connect', as24.deleteAutoScout24Credentials);

router.get('/autoscout24/remote-listings', as24.getAS24ListingsRemote);
router.post('/autoscout24/sync-now', as24.syncAS24);
router.get('/autoscout24/status', as24.getAS24Status);
router.get('/autoscout24/listings', as24.getAS24Listings);
router.post('/autoscout24/seed-dummy', as24.seedAS24Dummy);

module.exports = router;


