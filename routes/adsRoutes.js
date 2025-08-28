const express = require('express');
const router = express.Router();
const adsController = require('../controllers/adsController');
const { getReachEstimate } = require('../controllers/reachController');

router.get('/ads/ad-accounts', adsController.listAdAccounts);
router.post('/ads/recommendation', adsController.recommendAdPlan);
router.post('/ads/campaign', adsController.createCampaign);
router.get('/ads/insights', adsController.getInsights);
router.post('/ads/reach-estimate', getReachEstimate);

module.exports = router;


