'use strict';

const { z } = require('zod');
const roomService = require('../services/roomService');
const logger = require('../config/logger').child({ module: 'voiceHandlers' });

/**
 * Voice activity detection (VAD) is performed CLIENT-SIDE by the Agora SDK
 * (it exposes a volume-indicator callback per remote/local user). This
 * server does not analyze audio itself - it only relays each client's own
 * "I am currently speaking above threshold X" signal to the rest of the
 * room, so every client can render a speaking-indicator ring/glow around
 * the correct avatar. This is a deliberately lightweight, high-frequency,
 * best-effort relay (not persisted, not rate-limited as strictly as other
 * events, no acknowledgement) - losing an occasional VAD tick has no
 * correctness impact, unlike a dropped room:join or game:vote.
 */

const vadPayload = z.object({
  roomId: z.string().uuid(),
  isSpeaking: z.boolean(),
  // Agora's volume indicator returns 0-255; forwarded as-is so clients can
  // drive proportional animation intensity (e.g. glow radius) rather than
  // a flat on/off indicator.
  volume: z.number().min(0).max(255).optional(),
});

function registerVoiceHandlers(io, socket) {
  const userId = socket.data.userId;

  // Deliberately NOT wrapped in withRateLimit's Redis-backed limiter - VAD
  // events can fire many times per second per user, and routing every one
  // through a Redis INCR would add latency and load disproportionate to
  // the value of rate-limiting this particular event. A lightweight
  // in-memory throttle is applied instead: at most one broadcast per
  // 150ms per room for this socket, which is still smooth for UI purposes
  // (~6-7fps of indicator updates) while capping worst-case fan-out volume.
  const lastEmitAt = new Map(); // roomId -> timestamp, scoped per-socket via closure

  socket.on('voice:activity', (rawPayload) => {
    const parsed = vadPayload.safeParse(rawPayload);
    if (!parsed.success) return; // silently drop malformed - see rationale above

    const { roomId, isSpeaking, volume } = parsed.data;
    const now = Date.now();
    const last = lastEmitAt.get(roomId) || 0;
    if (now - last < 150) return;
    lastEmitAt.set(roomId, now);

    socket.to(roomId).emit('voice:activity', { userId, isSpeaking, volume });
  });

  // Explicit mute/unmute of OTHER people is already handled by
  // room:setMute (Layer 1), which updates persistent Redis member state,
  // enforces owner/admin-or-self permission, and broadcasts
  // room:memberUpdated. This handler is that same self-mute path exposed
  // under a voice-specific event name so the client's Agora-integration
  // code can toggle the local mic and the room's persisted mute state in
  // one call without needing to know about room:setMute's more general
  // (permission-checked-for-others) contract.
  socket.on('voice:selfMuteToggle', async (rawPayload) => {
    const parsed = z.object({ roomId: z.string().uuid(), muted: z.boolean() }).safeParse(rawPayload);
    if (!parsed.success) return;
    try {
      const updated = await roomService.setMemberMute({
        roomId: parsed.data.roomId,
        targetUserId: userId,
        muted: parsed.data.muted,
        actingUserId: userId,
      });
      io.to(parsed.data.roomId).emit('room:memberUpdated', updated);
    } catch (err) {
      logger.warn({ err: err.message, userId }, 'Failed to process self mute toggle');
    }
  });
}

module.exports = { registerVoiceHandlers };
