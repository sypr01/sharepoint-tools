const jwt = require('jsonwebtoken');

function getSecret() {
  return process.env.JWT_SECRET || 'plg-portal-secret-2026';
}

function verifyToken(req) {
  // Azure SWA puede eliminar el header Authorization; usar X-PLG-Auth como alternativa
  const custom = (req.headers && (req.headers['x-plg-auth'] || req.headers['X-PLG-Auth'])) || '';
  const auth   = (req.headers && req.headers.authorization) || '';
  const raw    = custom || auth;
  const token  = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
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
