'use strict';

const { redisClient } = require('../config/redis');
const env = require('../config/env');
const logger = require('../config/logger').child({ module: 'socketRateLimit' });

/**
 * Fixed-window rate limiter keyed by userId, applied per event name so a
 * burst on one event type doesn't starve others. Uses INCR + EXPIRE which is
 * atomic enough for this purpose (a tiny race on the very first increment in
 * a window at worst allows one extra request through, which is an acceptable
 * tradeoff for the simplicity/performance gain over a Lua-scripted sliding
 * window).
 */
async function checkRateLimit(userId, eventName) {
  const windowSeconds = Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000);
  const key = `ratelimit:${userId}:${eventName}`;

  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.expire(key, windowSeconds);
  }

  return count <= env.RATE_LIMIT_MAX;
}

/**
 * Wraps a socket event handler with rate limiting. On limit exceeded, emits
 * an 'error' event to the client and does not invoke the handler.
 */
function withRateLimit(eventName, handler) {
  return async function rateLimitedHandler(socket, ...args) {
    try {
      const allowed = await checkRateLimit(socket.data.userId, eventName);
      if (!allowed) {
        logger.warn({ userId: socket.data.userId, eventName }, 'Rate limit exceeded');
        socket.emit('error', { code: 'RATE_LIMITED', message: `Too many ${eventName} requests` });
        return;
      }
      await handler(socket, ...args);
    } catch (err) {
      logger.error({ err, eventName, userId: socket.data.userId }, 'Handler error');
      socket.emit('error', {
        code: err.code || 'INTERNAL_ERROR',
        message: err.code ? err.message : 'Something went wrong',
        details: err.details,
      });
    }
  };
}

module.exports = { checkRateLimit, withRateLimit };
