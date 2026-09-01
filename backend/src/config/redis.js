'use strict';

const Redis = require('ioredis');
const env = require('./env');
const logger = require('./logger');

/**
 * We maintain three distinct Redis connections by design:
 *  - `redisClient`   : general commands (GET/SET/HSET/etc), used by services
 *  - `redisPub`      : dedicated publisher for the Socket.IO adapter
 *  - `redisSub`      : dedicated subscriber for the Socket.IO adapter
 *
 * ioredis (and Redis itself) does not allow a connection in subscriber mode
 * to also run normal commands, so the Socket.IO adapter requires its own
 * pub/sub pair, separate from the client used by application services.
 */
function createClient(name) {
  const client = new Redis(env.REDIS_URL, {
    keyPrefix: env.REDIS_KEY_PREFIX,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    reconnectOnError(err) {
      logger.warn({ err, name }, 'Redis reconnectOnError triggered');
      return true;
    },
  });

  client.on('connect', () => logger.info({ name }, 'Redis connecting...'));
  client.on('ready', () => logger.info({ name }, 'Redis ready'));
  client.on('error', (err) => logger.error({ err, name }, 'Redis error'));
  client.on('close', () => logger.warn({ name }, 'Redis connection closed'));
  client.on('reconnecting', (delay) => logger.warn({ name, delay }, 'Redis reconnecting'));

  return client;
}

const redisClient = createClient('client');
// Pub/sub clients must NOT use keyPrefix - the Socket.IO adapter manages its
// own channel/key naming internally and prefixing would break cross-instance
// message matching.
const redisPub = new Redis(env.REDIS_URL);
const redisSub = new Redis(env.REDIS_URL);

redisPub.on('error', (err) => logger.error({ err, name: 'pub' }, 'Redis error'));
redisSub.on('error', (err) => logger.error({ err, name: 'sub' }, 'Redis error'));

async function closeAll() {
  await Promise.allSettled([redisClient.quit(), redisPub.quit(), redisSub.quit()]);
}

module.exports = { redisClient, redisPub, redisSub, closeAll };
