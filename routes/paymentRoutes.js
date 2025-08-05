const express = require('express');
const router = express.Router();
const {
  savePaymentMethod,
  getPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
} = require('../controllers/paymentController');

router.post('/payment-method', savePaymentMethod);
router.get('/payment-method', getPaymentMethod);
router.put('/payment-method', updatePaymentMethod);
router.delete('/payment-method', deletePaymentMethod);

module.exports = router;
