'use strict';

const { RtcTokenBuilder, RtcRole } = require('agora-token');
const env = require('../config/env');
const roomService = require('./roomService');
const logger = require('../config/logger').child({ module: 'voiceService' });

class VoiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VoiceError';
    this.code = code;
  }
}

function assertConfigured() {
  if (!env.AGORA_APP_ID || !env.AGORA_APP_CERTIFICATE) {
    throw new VoiceError('AGORA_NOT_CONFIGURED', 'Agora is not configured on this server (AGORA_APP_ID/AGORA_APP_CERTIFICATE missing)');
  }
}

/**
 * Maps Roomie's room roles (Layer 1: owner/admin/speaker/listener) to
 * Agora's two-tier RTC publisher/subscriber model. Owners, admins, and
 * speakers can publish audio (PUBLISHER); listeners can only receive
 * (SUBSCRIBER). This mapping is enforced server-side at token issuance
 * time - a listener physically cannot obtain a publisher token, so they
 * cannot unmute themselves by tampering with the client; only a role
 * change (via `room:setRole`, already gated to owner/admin in Layer 1) can
 * grant publish rights.
 */
function agoraRoleFor(roomRole) {
  const canPublish = roomRole === 'owner' || roomRole === 'admin' || roomRole === 'speaker';
  return canPublish ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
}

/**
 * Agora channel names have character restrictions and length limits; we
 * use the room's UUID directly, which is already URL-safe and within
 * limits, so no transformation is needed - documented here so it's clear
 * this isn't an oversight.
 */
function channelNameForRoom(roomId) {
  return roomId;
}

/**
 * Generates a time-limited Agora RTC token authorizing a specific user to
 * join a specific voice channel with a specific publish/subscribe
 * capability. The uid is derived deterministically from the Roomie userId
 * (hashed into Agora's required 32-bit unsigned integer range) so the same
 * user always maps to the same Agora uid across reconnects - relevant for
 * any Agora-side per-uid state like recording attribution.
 */
function deriveAgoraUid(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0; // unsigned 32-bit
  }
  // Avoid 0, which Agora reserves for "let the SDK assign one."
  return hash === 0 ? 1 : hash;
}

/**
 * Issues an Agora RTC token for a user to join the voice channel
 * corresponding to a Roomie room. Verifies the user is actually a member
 * of that room (via the Layer 1 room service) before issuing anything -
 * an Agora token is a bearer credential, so we don't want to hand one out
 * for a room the user hasn't joined.
 */
async function generateRoomVoiceToken({ roomId, userId }) {
  assertConfigured();

  const room = await roomService.getRoomState(roomId);
  if (!room) throw new VoiceError('ROOM_NOT_FOUND', 'Room does not exist');

  const member = room.members.find((m) => m.userId === userId);
  if (!member) throw new VoiceError('NOT_A_MEMBER', 'User is not a member of this room');

  const uid = deriveAgoraUid(userId);
  const role = agoraRoleFor(member.role);
  const channelName = channelNameForRoom(roomId);
  const expireSeconds = env.AGORA_TOKEN_TTL_SECONDS;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expireSeconds;

  const token = RtcTokenBuilder.buildTokenWithUid(
    env.AGORA_APP_ID,
    env.AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    role,
    privilegeExpiredTs,
    privilegeExpiredTs
  );

  logger.info(
    { roomId, userId, role: member.role, agoraRole: role === RtcRole.PUBLISHER ? 'publisher' : 'subscriber' },
    'Agora token issued'
  );

  return {
    appId: env.AGORA_APP_ID,
    channelName,
    token,
    uid,
    role: member.role,
    canPublish: role === RtcRole.PUBLISHER,
    expiresAt: privilegeExpiredTs * 1000,
  };
}

/**
 * Re-issues a token with an updated role after a `room:setRole` change
 * (e.g. promoted from listener to speaker). Agora tokens encode the
 * publish/subscribe privilege at issuance time and cannot be upgraded
 * in-place - the client must fetch a fresh token and, per Agora's SDK,
 * call renewToken or rejoin the channel with it. Identical implementation
 * to generateRoomVoiceToken; exposed as a separate named export so the
 * intent is clear at each call site.
 */
const regenerateTokenAfterRoleChange = generateRoomVoiceToken;

module.exports = {
  VoiceError,
  agoraRoleFor,
  deriveAgoraUid,
  generateRoomVoiceToken,
  regenerateTokenAfterRoleChange,
};
