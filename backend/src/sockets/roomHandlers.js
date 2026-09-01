'use strict';

const roomService = require('../services/roomService');
const missionService = require('../services/missionService');
const { withRateLimit } = require('../middleware/socketRateLimit');
const {
  validate,
  createRoomPayload,
  joinRoomPayload,
  roomIdOnlyPayload,
  roleChangePayload,
  mutePayload,
  handRaisePayload,
  memberActionPayload,
} = require('../utils/schemas');
const logger = require('../config/logger').child({ module: 'roomHandlers' });
const env = require('../config/env');

// Tracks pending disconnect-grace timers so a fast reconnect can cancel the
// scheduled removal. Keyed by `${roomId}:${userId}`.
const pendingRemovals = new Map();

function graceKey(roomId, userId) {
  return `${roomId}:${userId}`;
}

function registerRoomHandlers(io, socket) {
  const userId = socket.data.userId;
  const displayName = socket.data.displayName;

  socket.on(
    'room:create',
    withRateLimit('room:create', async (socket, rawPayload, ack) => {
      const payload = validate(createRoomPayload, rawPayload);

      const room = await roomService.createRoom({
        ownerId: userId,
        ownerDisplayName: displayName,
        name: payload.name,
        visibility: payload.visibility,
        passwordHash: payload.password || null,
        maxMembers: payload.maxMembers,
      });

      await socket.join(room.id);
      await roomService.bindSocket({ roomId: room.id, userId, socketId: socket.id });

      logger.info({ roomId: room.id, userId }, 'room:create success');
      safeAck(ack, { ok: true, room: sanitizeRoom(room) });
      io.to(room.id).emit('room:state', sanitizeRoom(room));
    })
  );

  socket.on(
    'room:join',
    withRateLimit('room:join', async (socket, rawPayload, ack) => {
      const payload = validate(joinRoomPayload, rawPayload);

      const room = await roomService.joinRoom({
        roomId: payload.roomId,
        userId,
        displayName,
        passwordAttempt: payload.password || null,
      });

      await socket.join(room.id);
      await roomService.bindSocket({ roomId: room.id, userId, socketId: socket.id });

      // Cancel any pending grace-period removal if this is a fast reconnect.
      const key = graceKey(room.id, userId);
      if (pendingRemovals.has(key)) {
        clearTimeout(pendingRemovals.get(key));
        pendingRemovals.delete(key);
        await roomService.markReconnected({ roomId: room.id, userId });
      }

      logger.info({ roomId: room.id, userId }, 'room:join success');
      safeAck(ack, { ok: true, room: sanitizeRoom(room) });

      // Mission progress tracking (Layer 4). Fire-and-forget: a mission
      // tracking hiccup must never block or fail the room join itself, so
      // errors are logged, not thrown.
      missionService.incrementMissionProgress(userId, 'join_3_rooms', 1).catch((err) => {
        logger.warn({ err, userId }, 'Failed to increment join_3_rooms mission progress');
      });

      const freshState = await roomService.getRoomState(room.id);
      io.to(room.id).emit('room:state', sanitizeRoom(freshState));
      socket.to(room.id).emit('room:memberJoined', {
        userId,
        displayName,
        roomId: room.id,
      });
    })
  );

  socket.on(
    'room:leave',
    withRateLimit('room:leave', async (socket, rawPayload, ack) => {
      const payload = validate(roomIdOnlyPayload, rawPayload);
      const { roomId } = payload;

      const result = await roomService.leaveRoom({ roomId, userId });
      await socket.leave(roomId);
      await roomService.unbindSocket({ roomId, socketId: socket.id });

      logger.info({ roomId, userId, result }, 'room:leave success');
      safeAck(ack, { ok: true, ...result });

      if (!result.roomDeleted) {
        const freshState = await roomService.getRoomState(roomId);
        io.to(roomId).emit('room:state', sanitizeRoom(freshState));
        io.to(roomId).emit('room:memberLeft', { userId, roomId, newOwnerId: result.newOwnerId });
      }
    })
  );

  socket.on(
    'room:setRole',
    withRateLimit('room:setRole', async (socket, rawPayload, ack) => {
      const payload = validate(roleChangePayload, rawPayload);
      const updated = await roomService.updateMemberRole({
        roomId: payload.roomId,
        targetUserId: payload.targetUserId,
        newRole: payload.newRole,
        actingUserId: userId,
      });
      safeAck(ack, { ok: true, member: updated });
      io.to(payload.roomId).emit('room:memberUpdated', updated);

      // Voice publish/subscribe capability (Layer 6) is baked into the
      // Agora token at issuance time and can't be upgraded in-place, so we
      // tell the affected client's socket directly to fetch a fresh token
      // via POST /api/voice/token and rejoin/renew their Agora channel
      // session. Broadcasting to the whole room would be wasteful - only
      // the promoted/demoted user's voice capability actually changed.
      const roleChangeTargetSocketId = await roomService.getSocketForUser({
        roomId: payload.roomId,
        userId: payload.targetUserId,
      });
      if (roleChangeTargetSocketId) {
        io.to(roleChangeTargetSocketId).emit('voice:roleChanged', { roomId: payload.roomId, newRole: payload.newRole });
      }
    })
  );

  socket.on(
    'room:setMute',
    withRateLimit('room:setMute', async (socket, rawPayload, ack) => {
      const payload = validate(mutePayload, rawPayload);
      const updated = await roomService.setMemberMute({
        roomId: payload.roomId,
        targetUserId: payload.targetUserId,
        muted: payload.muted,
        actingUserId: userId,
      });
      safeAck(ack, { ok: true, member: updated });
      io.to(payload.roomId).emit('room:memberUpdated', updated);
    })
  );

  socket.on(
    'room:raiseHand',
    withRateLimit('room:raiseHand', async (socket, rawPayload, ack) => {
      const payload = validate(handRaisePayload, rawPayload);
      const updated = await roomService.setHandRaised({
        roomId: payload.roomId,
        userId,
        raised: payload.raised,
      });
      safeAck(ack, { ok: true, member: updated });
      io.to(payload.roomId).emit('room:memberUpdated', updated);
    })
  );

  socket.on(
    'room:kick',
    withRateLimit('room:kick', async (socket, rawPayload, ack) => {
      const payload = validate(memberActionPayload, rawPayload);
      const result = await roomService.kickMember({
        roomId: payload.roomId,
        targetUserId: payload.targetUserId,
        actingUserId: userId,
      });
      safeAck(ack, { ok: true, ...result });

      const targetSocketId = await roomService.getSocketForUser({
        roomId: payload.roomId,
        userId: payload.targetUserId,
      });
      if (targetSocketId) {
        io.to(targetSocketId).emit('room:kicked', { roomId: payload.roomId });
        io.sockets.sockets.get(targetSocketId)?.leave(payload.roomId);
      }

      if (!result.roomDeleted) {
        const freshState = await roomService.getRoomState(payload.roomId);
        io.to(payload.roomId).emit('room:state', sanitizeRoom(freshState));
      }
    })
  );

  socket.on(
    'presence:heartbeat',
    withRateLimit('presence:heartbeat', async (socket) => {
      await roomService.setPresence(userId);
    })
  );

  socket.on('disconnect', async (reason) => {
    logger.info({ userId, socketId: socket.id, reason }, 'Socket disconnected');

    const currentRoomId = await roomService.getUserCurrentRoom(userId);
    if (!currentRoomId) return;

    const socketOwnerId = await roomService.getUserForSocket({ roomId: currentRoomId, socketId: socket.id });
    if (socketOwnerId !== userId) {
      // Stale socket mapping (e.g. this was already replaced by a newer
      // connection) - nothing to clean up.
      return;
    }

    await roomService.unbindSocket({ roomId: currentRoomId, socketId: socket.id });
    const member = await roomService.markDisconnected({ roomId: currentRoomId, userId });
    if (!member) return;

    io.to(currentRoomId).emit('room:memberUpdated', member);

    const key = graceKey(currentRoomId, userId);
    const timer = setTimeout(async () => {
      pendingRemovals.delete(key);
      try {
        // If the user reconnected to a *different* socket in the meantime,
        // userToSocket will have been repopulated by bindSocket - check
        // before finalizing removal.
        const activeSocket = await roomService.getSocketForUser({ roomId: currentRoomId, userId });
        if (activeSocket) {
          logger.info({ roomId: currentRoomId, userId }, 'Grace period expired but user reconnected - skipping removal');
          return;
        }

        const result = await roomService.leaveRoom({ roomId: currentRoomId, userId });
        logger.info({ roomId: currentRoomId, userId, result }, 'Grace period expired - member removed');

        if (!result.roomDeleted) {
          const freshState = await roomService.getRoomState(currentRoomId);
          io.to(currentRoomId).emit('room:state', sanitizeRoom(freshState));
          io.to(currentRoomId).emit('room:memberLeft', {
            userId,
            roomId: currentRoomId,
            newOwnerId: result.newOwnerId,
            reason: 'timeout',
          });
        }
      } catch (err) {
        logger.error({ err, roomId: currentRoomId, userId }, 'Error finalizing grace-period removal');
      }
    }, env.RECONNECT_GRACE_SECONDS * 1000);

    pendingRemovals.set(key, timer);
  });
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

/** Strips internal-only fields before broadcasting to clients. */
function sanitizeRoom(room) {
  if (!room) return null;
  const { passwordHash, ...rest } = room;
  return rest;
}

module.exports = { registerRoomHandlers };
