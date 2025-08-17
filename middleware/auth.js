// backend/middleware/auth.js
const { verifyToken } = require('../utils/jwtUtils');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired access token' });
  }
};


const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();  // Admin has access
  } else {
    return res.status(403).json({ error: 'Admin access required' });
  }
};

// const isClient = (req, res, next) => {
//   if (req.user && req.user.role === 'client') {
//     next();  // Client has access
//   } else {
//     return res.status(403).json({ error: 'Client access required' });
//   }
// };

module.exports = {
  authenticateToken,
  isAdmin,
  // isClient,
};
