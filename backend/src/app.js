'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./config/logger');
const healthRoutes = require('./routes/health');
const roomsRoutes = require('./routes/rooms');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const economyRoutes = require('./routes/economy');
const voiceRoutes = require('./routes/voice');
const webhookRoutes = require('./routes/webhooks');

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
    })
  );

  // Webhooks MUST be mounted before express.json() - Stripe signature
  // verification needs the raw, unparsed request body (see routes/webhooks.js
  // for the full explanation). Everything after this line uses parsed JSON.
  app.use('/api/webhooks', webhookRoutes);

  app.use(express.json({ limit: '256kb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));

  const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  app.use('/', healthRoutes);
  app.use('/api', roomsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/economy', economyRoutes);
  app.use('/api/voice', voiceRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
  });

  // Centralized error handler - must have 4 args for Express to recognize it.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled Express error');
    res.status(err.status || 500).json({
      error: err.code || 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
    });
  });

  return app;
}

module.exports = createApp;
