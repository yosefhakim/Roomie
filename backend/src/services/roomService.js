'use strict';

const { v4: uuidv4 } = require('uuid');
const { redisClient } = require('../config/redis');
const env = require('../config/env');
const logger = require('../config/logger').child({ module: 'roomService' });

/**
 * Redis key layout
 * ------------------------------------------------------------------
 * room:{roomId}                 HASH   room metadata (id, name, ownerId, visibility, createdAt, maxMembers)
 * room:{roomId}:members         HASH   userId -> JSON({ userId, displayName, role, joinedAt, connected })
 * room:{roomId}:socketToUser    HASH   socketId -> userId   (for disconnect lookups)
 * room:{roomId}:userToSocket    HASH   userId -> socketId   (current active socket for a user)
 * rooms:active                  SET    roomIds that currently have >=1 member
 * user:{userId}:room            STRING roomId the user currently belongs to (single-room-at-a-time model)
 * presence:{userId}             STRING "1" with TTL, renewed on heartbeat
 * ------------------------------------------------------------------
 */

const ROLES = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  SPEAKER: 'speaker',
  LISTENER: 'listener',
});

const VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
  PASSWORD: 'password',
});

class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

function roomKey(roomId) {
  return `room:${roomId}`;
}
function membersKey(roomId) {
  return `room:${roomId}:members`;
}
function socketToUserKey(roomId) {
  return `room:${roomId}:socketToUser`;
}
function userToSocketKey(roomId) {
  return `room:${roomId}:userToSocket`;
}
function userRoomKey(userId) {
  return `user:${userId}:room`;
}
function presenceKey(userId) {
  return `presence:${userId}`;
}

/**
 * Create a new room. Owner is automatically added as first member.
 */
async function createRoom({ ownerId, ownerDisplayName, name, visibility = VISIBILITY.PUBLIC, passwordHash = null, maxMembers }) {
  if (!ownerId || !name) {
    throw new RoomError('INVALID_INPUT', 'ownerId and name are required to create a room');
  }

  const existingRoomId = await redisClient.get(userRoomKey(ownerId));
  if (existingRoomId) {
    throw new RoomError('ALREADY_IN_ROOM', `User is already in room ${existingRoomId}`);
  }

  const roomId = uuidv4();
  const createdAt = Date.now();
  const cap = Math.min(maxMembers || env.ROOM_MAX_MEMBERS, env.ROOM_MAX_MEMBERS);

  const pipeline = redisClient.pipeline();
  pipeline.hset(roomKey(roomId), {
    id: roomId,
    name,
    ownerId,
    visibility,
    passwordHash: passwordHash || '',
    maxMembers: cap,
    createdAt,
    status: 'lobby',
  });
  pipeline.expire(roomKey(roomId), env.ROOM_INACTIVE_TTL_SECONDS);

  const ownerMember = {
    userId: ownerId,
    displayName: ownerDisplayName || 'Owner',
    role: ROLES.OWNER,
    joinedAt: createdAt,
    connected: true,
    muted: false,
    handRaised: false,
  };
  pipeline.hset(membersKey(roomId), ownerId, JSON.stringify(ownerMember));
  pipeline.expire(membersKey(roomId), env.ROOM_INACTIVE_TTL_SECONDS);

  pipeline.set(userRoomKey(ownerId), roomId, 'EX', env.ROOM_INACTIVE_TTL_SECONDS);
  pipeline.sadd('rooms:active', roomId);

  await pipeline.exec();

  logger.info({ roomId, ownerId }, 'Room created');
  return getRoomState(roomId);
}

/**
 * Join an existing room. Enforces capacity and password checks atomically
 * via a Lua script to avoid race conditions between the capacity check and
 * the member insert under concurrent joins.
 */
const JOIN_ROOM_LUA = `
local roomKey = KEYS[1]
local membersKey = KEYS[2]
local userRoomKey = KEYS[3]
local userId = ARGV[1]
local memberJson = ARGV[2]
local maxMembers = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

if redis.call('EXISTS', roomKey) == 0 then
  return {err = 'ROOM_NOT_FOUND'}
end

local alreadyMember = redis.call('HEXISTS', membersKey, userId)
if alreadyMember == 1 then
  -- Rejoin (e.g. reconnect) is allowed; just refresh their entry below.
else
  local count = redis.call('HLEN', membersKey)
  if count >= maxMembers then
    return {err = 'ROOM_FULL'}
  end
end

redis.call('HSET', membersKey, userId, memberJson)
redis.call('EXPIRE', membersKey, ttl)
redis.call('EXPIRE', roomKey, ttl)
redis.call('SET', userRoomKey, redis.call('HGET', roomKey, 'id'), 'EX', ttl)
redis.call('SADD', 'rooms:active', redis.call('HGET', roomKey, 'id'))

return {ok = 'JOINED'}
`;

async function joinRoom({ roomId, userId, displayName, passwordAttempt = null }) {
  const room = await redisClient.hgetall(roomKey(roomId));
  if (!room || Object.keys(room).length === 0) {
    throw new RoomError('ROOM_NOT_FOUND', `Room ${roomId} does not exist`);
  }

  if (room.visibility === VISIBILITY.PASSWORD) {
    if (!passwordAttempt || passwordAttempt !== room.passwordHash) {
      throw new RoomError('BAD_PASSWORD', 'Incorrect room password');
    }
  }

  const currentRoomId = await redisClient.get(userRoomKey(userId));
  if (currentRoomId && currentRoomId !== roomId) {
    throw new RoomError('ALREADY_IN_ROOM', `User is already in room ${currentRoomId}`);
  }

  const existingRaw = await redisClient.hget(membersKey(roomId), userId);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;

  const member = {
    userId,
    displayName: displayName || existing?.displayName || 'Guest',
    role: existing?.role || ROLES.LISTENER,
    joinedAt: existing?.joinedAt || Date.now(),
    connected: true,
    muted: existing?.muted ?? true,
    handRaised: false,
  };

  let result;
  try {
    result = await redisClient.eval(
      JOIN_ROOM_LUA,
      3,
      roomKey(roomId),
      membersKey(roomId),
      userRoomKey(userId),
      userId,
      JSON.stringify(member),
      room.maxMembers,
      env.ROOM_INACTIVE_TTL_SECONDS
    );
  } catch (err) {
    if (err.message.includes('ROOM_FULL')) throw new RoomError('ROOM_FULL', 'Room has reached max capacity');
    if (err.message.includes('ROOM_NOT_FOUND')) throw new RoomError('ROOM_NOT_FOUND', 'Room no longer exists');
    throw err;
  }

  logger.info({ roomId, userId, result }, 'User joined room');
  return getRoomState(roomId);
}

/**
 * Bind a socket to a user within a room (called on socket connection/auth).
 */
async function bindSocket({ roomId, userId, socketId }) {
  const pipeline = redisClient.pipeline();
  pipeline.hset(socketToUserKey(roomId), socketId, userId);
  pipeline.hset(userToSocketKey(roomId), userId, socketId);
  pipeline.expire(socketToUserKey(roomId), env.ROOM_INACTIVE_TTL_SECONDS);
  pipeline.expire(userToSocketKey(roomId), env.ROOM_INACTIVE_TTL_SECONDS);
  await pipeline.exec();
  await setPresence(userId);
}

async function unbindSocket({ roomId, socketId }) {
  const userId = await redisClient.hget(socketToUserKey(roomId), socketId);
  if (!userId) return null;

  const pipeline = redisClient.pipeline();
  pipeline.hdel(socketToUserKey(roomId), socketId);
  // Only clear userToSocket if it still points at this exact socket
  // (avoids clobbering a newer socket from a fast reconnect).
  const currentSocketForUser = await redisClient.hget(userToSocketKey(roomId), userId);
  if (currentSocketForUser === socketId) {
    pipeline.hdel(userToSocketKey(roomId), userId);
  }
  await pipeline.exec();
  return userId;
}

/**
 * Mark a member as disconnected but keep their seat for the reconnect grace
 * window. Actual removal happens via `finalizeLeaveIfExpired` after the
 * grace period, driven by the socket layer's disconnect timer.
 */
async function markDisconnected({ roomId, userId }) {
  const raw = await redisClient.hget(membersKey(roomId), userId);
  if (!raw) return null;
  const member = JSON.parse(raw);
  member.connected = false;
  member.disconnectedAt = Date.now();
  await redisClient.hset(membersKey(roomId), userId, JSON.stringify(member));
  return member;
}

async function markReconnected({ roomId, userId }) {
  const raw = await redisClient.hget(membersKey(roomId), userId);
  if (!raw) return null;
  const member = JSON.parse(raw);
  member.connected = true;
  delete member.disconnectedAt;
  await redisClient.hset(membersKey(roomId), userId, JSON.stringify(member));
  await setPresence(userId);
  return member;
}

/**
 * Permanently remove a member from a room. If the departing member was the
 * owner, ownership transfers to the longest-tenured remaining member. If the
 * room becomes empty, it is torn down.
 */
async function leaveRoom({ roomId, userId }) {
  const raw = await redisClient.hget(membersKey(roomId), userId);
  if (!raw) return { removed: false, roomDeleted: false };

  const room = await redisClient.hgetall(roomKey(roomId));
  const wasOwner = room.ownerId === userId;

  const pipeline = redisClient.pipeline();
  pipeline.hdel(membersKey(roomId), userId);
  pipeline.hdel(userToSocketKey(roomId), userId);
  pipeline.del(userRoomKey(userId));
  await pipeline.exec();

  const remaining = await redisClient.hgetall(membersKey(roomId));
  const remainingMembers = Object.values(remaining).map((v) => JSON.parse(v));

  if (remainingMembers.length === 0) {
    await destroyRoom(roomId);
    logger.info({ roomId }, 'Room destroyed - empty after last member left');
    return { removed: true, roomDeleted: true, newOwnerId: null };
  }

  let newOwnerId = null;
  if (wasOwner) {
    const nextOwner = remainingMembers.sort((a, b) => a.joinedAt - b.joinedAt)[0];
    nextOwner.role = ROLES.OWNER;
    await redisClient.hset(membersKey(roomId), nextOwner.userId, JSON.stringify(nextOwner));
    await redisClient.hset(roomKey(roomId), 'ownerId', nextOwner.userId);
    newOwnerId = nextOwner.userId;
    logger.info({ roomId, newOwnerId }, 'Ownership transferred after owner left');
  }

  return { removed: true, roomDeleted: false, newOwnerId };
}

async function destroyRoom(roomId) {
  const pipeline = redisClient.pipeline();
  pipeline.del(roomKey(roomId));
  pipeline.del(membersKey(roomId));
  pipeline.del(socketToUserKey(roomId));
  pipeline.del(userToSocketKey(roomId));
  pipeline.srem('rooms:active', roomId);
  await pipeline.exec();
}

async function getRoomState(roomId) {
  const [room, membersRaw] = await Promise.all([
    redisClient.hgetall(roomKey(roomId)),
    redisClient.hgetall(membersKey(roomId)),
  ]);
  if (!room || Object.keys(room).length === 0) return null;

  const members = Object.values(membersRaw)
    .map((v) => JSON.parse(v))
    .sort((a, b) => a.joinedAt - b.joinedAt);

  return {
    id: room.id,
    name: room.name,
    ownerId: room.ownerId,
    visibility: room.visibility,
    maxMembers: Number(room.maxMembers),
    createdAt: Number(room.createdAt),
    status: room.status,
    memberCount: members.length,
    members,
  };
}

async function updateMemberRole({ roomId, targetUserId, newRole, actingUserId }) {
  const [actingRaw, targetRaw] = await Promise.all([
    redisClient.hget(membersKey(roomId), actingUserId),
    redisClient.hget(membersKey(roomId), targetUserId),
  ]);
  if (!actingRaw || !targetRaw) throw new RoomError('MEMBER_NOT_FOUND', 'Member not found in room');

  const acting = JSON.parse(actingRaw);
  if (![ROLES.OWNER, ROLES.ADMIN].includes(acting.role)) {
    throw new RoomError('FORBIDDEN', 'Only owner/admin can change roles');
  }
  if (!Object.values(ROLES).includes(newRole)) {
    throw new RoomError('INVALID_ROLE', `Unknown role: ${newRole}`);
  }

  const target = JSON.parse(targetRaw);
  target.role = newRole;
  await redisClient.hset(membersKey(roomId), targetUserId, JSON.stringify(target));
  return target;
}

async function setMemberMute({ roomId, targetUserId, muted, actingUserId }) {
  const actingRaw = await redisClient.hget(membersKey(roomId), actingUserId);
  const targetRaw = await redisClient.hget(membersKey(roomId), targetUserId);
  if (!actingRaw || !targetRaw) throw new RoomError('MEMBER_NOT_FOUND', 'Member not found in room');

  const acting = JSON.parse(actingRaw);
  const isSelf = actingUserId === targetUserId;
  if (!isSelf && ![ROLES.OWNER, ROLES.ADMIN].includes(acting.role)) {
    throw new RoomError('FORBIDDEN', 'Only owner/admin can mute others');
  }

  const target = JSON.parse(targetRaw);
  target.muted = muted;
  await redisClient.hset(membersKey(roomId), targetUserId, JSON.stringify(target));
  return target;
}

async function setHandRaised({ roomId, userId, raised }) {
  const raw = await redisClient.hget(membersKey(roomId), userId);
  if (!raw) throw new RoomError('MEMBER_NOT_FOUND', 'Member not found in room');
  const member = JSON.parse(raw);
  member.handRaised = raised;
  await redisClient.hset(membersKey(roomId), userId, JSON.stringify(member));
  return member;
}

async function kickMember({ roomId, targetUserId, actingUserId }) {
  const actingRaw = await redisClient.hget(membersKey(roomId), actingUserId);
  if (!actingRaw) throw new RoomError('MEMBER_NOT_FOUND', 'Acting member not found');
  const acting = JSON.parse(actingRaw);
  if (![ROLES.OWNER, ROLES.ADMIN].includes(acting.role)) {
    throw new RoomError('FORBIDDEN', 'Only owner/admin can kick');
  }
  if (targetUserId === acting.userId && acting.role === ROLES.OWNER) {
    throw new RoomError('INVALID_ACTION', 'Owner cannot kick self; use leaveRoom instead');
  }
  return leaveRoom({ roomId, userId: targetUserId });
}

async function setPresence(userId) {
  await redisClient.set(presenceKey(userId), '1', 'EX', env.PRESENCE_TTL_SECONDS);
}

async function isPresent(userId) {
  const val = await redisClient.get(presenceKey(userId));
  return val === '1';
}

async function getUserCurrentRoom(userId) {
  return redisClient.get(userRoomKey(userId));
}

async function getSocketForUser({ roomId, userId }) {
  return redisClient.hget(userToSocketKey(roomId), userId);
}

async function getUserForSocket({ roomId, socketId }) {
  return redisClient.hget(socketToUserKey(roomId), socketId);
}

async function listActiveRooms({ limit = 50 } = {}) {
  const roomIds = await redisClient.smembers('rooms:active');
  const slice = roomIds.slice(0, limit);
  const states = await Promise.all(slice.map((id) => getRoomState(id)));
  return states.filter(Boolean);
}

module.exports = {
  ROLES,
  VISIBILITY,
  RoomError,
  createRoom,
  joinRoom,
  bindSocket,
  unbindSocket,
  markDisconnected,
  markReconnected,
  leaveRoom,
  destroyRoom,
  getRoomState,
  updateMemberRole,
  setMemberMute,
  setHandRaised,
  kickMember,
  setPresence,
  isPresent,
  getUserCurrentRoom,
  getSocketForUser,
  getUserForSocket,
  listActiveRooms,
};
