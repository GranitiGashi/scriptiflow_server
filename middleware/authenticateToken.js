const jwt = require('jsonwebtoken');
const { JWT_SECRET } = process.env;

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];  // Extract token from Authorization header

  if (!token) {
    return res.status(401).json({ error: 'Token is required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
    }

    req.user = user;  // Attach the decoded user to the request object
    next();  // Continue to the next middleware or controller
  });
};

module.exports = authenticateToken;
