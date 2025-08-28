const express = require('express');
const router = express.Router();
const {
  savePaymentMethod,
  getPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  createSetupIntent,
  chargeSavedCard,
  createPaymentIntent,
} = require('../controllers/paymentController');

router.post('/payment-method', savePaymentMethod);
router.get('/payment-method', getPaymentMethod);
router.put('/payment-method', updatePaymentMethod);
router.delete('/payment-method', deletePaymentMethod);
router.post('/payment-method/setup-intent', createSetupIntent);

// Payment processing routes
router.post('/payment/charge-saved-card', chargeSavedCard);
router.post('/create-payment-intent', createPaymentIntent);

module.exports = router;
