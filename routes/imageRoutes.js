const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');
const upload = require('../middleware/upload');

router.post('/images/process', imageController.enqueueProcessing);
router.get('/images/status', imageController.getJobStatus);
router.post('/images/reprocess', imageController.reprocessListing);
router.post('/images/run-once', imageController.runOnce);
router.post('/images/upload', upload.array('files', 20), imageController.enqueueFromUpload);

module.exports = router;


