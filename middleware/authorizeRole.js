// /middleware/authorizeRole.js

function isAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access forbidden: Admins only' });
  }
  next();  // Proceed to the next middleware or route handler
}

function authorizeRole(allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access forbidden' });
    }
    next();  // Proceed to the next middleware or route handler
  };
}

module.exports = { isAdmin, authorizeRole };
