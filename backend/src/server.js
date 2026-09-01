'use strict';

const http = require('http');
const env = require('./config/env');
const logger = require('./config/logger');
const createApp = require('./app');
const { initSocketServer } = require('./sockets');
const { redisClient, closeAll } = require('./config/redis');
const { pool } = require('./db/pool');

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = initSocketServer(httpServer);
  // Exposed via app.get('io') so REST routes (e.g. admin force-close-room)
  // can emit socket broadcasts without a circular require between app.js
  // and sockets/index.js.
  app.set('io', io);

  // Fail fast if Redis or Postgres is unreachable at boot rather than
  // accepting connections into a broken state.
  await redisClient.ping();
  logger.info('Redis ping successful, backend store reachable');

  await pool.query('SELECT 1');
  logger.info('Postgres ping successful, database reachable');

  httpServer.listen(env.PORT, env.HOST, () => {
    logger.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV }, 'Roomie backend listening');
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown initiated');

    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000);

    try {
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
      await closeAll();
      await pool.end();
      clearTimeout(forceExitTimer);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
