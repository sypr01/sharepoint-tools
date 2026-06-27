const jwt = require('jsonwebtoken');

function getSecret() {
  return process.env.JWT_SECRET || 'plg-portal-secret-2026';
}

function verifyToken(req) {
  const header = (req.headers && req.headers.authorization) || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '10h' });
}

module.exports = { verifyToken, signToken };
