'use strict';

const tokenService = require('../services/tokenService');
const userRepo = require('../services/userRepository');
const logger = require('../config/logger').child({ module: 'socketAuth' });

const { AuthError } = tokenService;

/**
 * Real authentication boundary (Layer 2). Replaces the Layer 1 stub that
 * trusted a client-supplied userId. Every downstream socket handler still
 * only reads `socket.data.userId` / `socket.data.displayName` - the
 * contract with room handlers is unchanged, only how those fields get
 * populated changed.
 *
 * Client must connect with `auth: { accessToken: "<JWT>" }`. On expiry the
 * client is expected to hit POST /api/auth/refresh over HTTP to get a new
 * access token and reconnect the socket - sockets do not perform refresh
 * themselves, keeping the refresh-token flow entirely server-side over TLS.
 */
async function socketAuthMiddleware(socket, next) {
  const { accessToken } = socket.handshake.auth || {};

  if (!accessToken || typeof accessToken !== 'string') {
    logger.warn({ socketId: socket.id }, 'Socket connection rejected: missing accessToken');
    return next(new Error('UNAUTHENTICATED'));
  }

  let claims;
  try {
    claims = tokenService.verifyAccessToken(accessToken);
  } catch (err) {
    const reason = err instanceof AuthError ? err.code : 'INVALID_TOKEN';
    logger.warn({ socketId: socket.id, reason }, 'Socket connection rejected: token verification failed');
    return next(new Error(reason));
  }

  // Re-check ban status on every connection (not just at token issuance) so
  // a ban applied mid-session takes effect on the next reconnect rather
  // than waiting for the (up to 15 min) access token to expire naturally.
  let user;
  try {
    user = await userRepo.findById(claims.sub);
  } catch (err) {
    logger.error({ err, socketId: socket.id }, 'Failed to look up user during socket auth');
    return next(new Error('INTERNAL_ERROR'));
  }

  if (!user) {
    return next(new Error('USER_NOT_FOUND'));
  }
  if (user.is_banned) {
    logger.info({ userId: user.id, socketId: socket.id }, 'Socket connection rejected: user banned');
    return next(new Error('ACCOUNT_BANNED'));
  }

  socket.data.userId = user.id;
  socket.data.displayName = user.display_name;
  socket.data.isAdmin = user.is_admin;
  socket.data.authenticatedAt = Date.now();

  next();
}

module.exports = socketAuthMiddleware;
