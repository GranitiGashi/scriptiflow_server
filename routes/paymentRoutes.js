const express = require('express');
const router = express.Router();
const {
  savePaymentMethod,
  getPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  createSetupIntent,
} = require('../controllers/paymentController');

router.post('/payment-method', savePaymentMethod);
router.get('/payment-method', getPaymentMethod);
router.put('/payment-method', updatePaymentMethod);
router.delete('/payment-method', deletePaymentMethod);
router.post('/payment-method/setup-intent', createSetupIntent);

module.exports = router;
