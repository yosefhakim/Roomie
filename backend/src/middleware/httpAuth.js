'use strict';

const tokenService = require('../services/tokenService');
const { AuthError } = tokenService;

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Missing bearer token' });
  }

  const token = header.slice('Bearer '.length);
  try {
    const claims = tokenService.verifyAccessToken(token);
    req.user = { id: claims.sub, username: claims.username, displayName: claims.displayName, isAdmin: claims.isAdmin };
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({ error: err.code, message: err.message });
    }
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
