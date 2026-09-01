'use strict';

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const env = require('../config/env');
const logger = require('../config/logger').child({ module: 'sockets' });
const { redisPub, redisSub } = require('../config/redis');
const socketAuthMiddleware = require('../middleware/socketAuth');
const { registerRoomHandlers } = require('./roomHandlers');
const { registerVoiceHandlers } = require('./voiceHandlers');
const { registerGameHandlers } = require('../games/gameHandlers');

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGINS,
      credentials: true,
    },
    pingInterval: env.SOCKET_PING_INTERVAL_MS,
    pingTimeout: env.SOCKET_PING_TIMEOUT_MS,
    // Reasonable payload cap - prevents abuse via oversized event payloads.
    maxHttpBufferSize: 1e6,
  });

  // Redis adapter enables this server to scale horizontally: events emitted
  // via `io.to(room).emit(...)` on one instance reach sockets connected to
  // any other instance sharing this Redis backend.
  io.adapter(createAdapter(redisPub, redisSub));

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, 'Socket connected');

    registerRoomHandlers(io, socket);
    registerVoiceHandlers(io, socket);
    registerGameHandlers(io, socket);

    socket.on('error', (err) => {
      logger.error({ err, socketId: socket.id, userId: socket.data.userId }, 'Socket-level error');
    });
  });

  io.engine.on('connection_error', (err) => {
    logger.warn({ code: err.code, message: err.message, context: err.context }, 'Engine connection error');
  });

  return io;
}

module.exports = { initSocketServer };
