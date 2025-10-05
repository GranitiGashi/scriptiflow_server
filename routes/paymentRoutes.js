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
  getStripeStatus,
  createCheckoutSession,
  listInvoices,
} = require('../controllers/paymentController');

router.post('/payment-method', savePaymentMethod);
router.get('/payment-method', getPaymentMethod);
router.put('/payment-method', updatePaymentMethod);
router.delete('/payment-method', deletePaymentMethod);
router.post('/payment-method/setup-intent', createSetupIntent);
router.get('/stripe/status', getStripeStatus);

// Payment processing routes
router.post('/payment/charge-saved-card', chargeSavedCard);
router.post('/create-payment-intent', createPaymentIntent);
router.post('/pricing/create-checkout-session', createCheckoutSession);
router.get('/billing/invoices', listInvoices);

module.exports = router;
