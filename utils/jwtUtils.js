const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'aff51256575b1b07cc23ec80c8ddb362';

// require('dotenv').config();

function createToken(data) {
  return jwt.sign(data, SECRET, { expiresIn: '7d' });
}

function decodeToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function verifyToken(token) {
  return jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
}

module.exports = { createToken, decodeToken, verifyToken };
