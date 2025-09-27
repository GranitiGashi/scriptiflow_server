const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');

router.post('/images/process', imageController.enqueueProcessing);
router.get('/images/status', imageController.getJobStatus);
router.post('/images/reprocess', imageController.reprocessListing);

module.exports = router;


