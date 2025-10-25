// workers/serviceAuth.js
const crypto = require('crypto');

// Generate a service token for external cron services
const generateServiceToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Verify service token
const verifyServiceToken = (token) => {
  const validToken = process.env.SERVICE_TOKEN;
  return token === validToken;
};

module.exports = {
  generateServiceToken,
  verifyServiceToken
};
