'use strict';

const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
  base: { service: 'roomie-backend' },
});

module.exports = logger;
