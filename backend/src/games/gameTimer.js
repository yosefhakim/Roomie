'use strict';

const logger = require('../config/logger').child({ module: 'gameTimer' });

/**
 * Server-authoritative timers for game phase transitions. Timers live only
 * in server process memory (a Map keyed by roomId) - they are NOT persisted
 * to Redis, by design: if the server restarts, in-flight game timers are
 * lost along with the process, which is an acceptable tradeoff for this
 * layer (a restart mid-game ends the game) versus the complexity of
 * distributed timer recovery. This does mean game timers do not survive a
 * server restart or failover to another instance - documented as a known
 * limitation below.
 *
 * "Server-authoritative" here means: the timer's expiry is what actually
 * triggers the phase transition (calling `onExpire`), not any client-sent
 * message. Clients only ever receive the resulting `phaseEndsAt` timestamp
 * and render a local countdown UI against it (client-side prediction of
 * the *display*, never of the *transition itself*).
 */
const activeTimers = new Map(); // roomId -> { timeoutHandle, phaseEndsAt }

function schedulePhaseEnd(roomId, durationMs, onExpire) {
  clearPhaseTimer(roomId);

  const phaseEndsAt = Date.now() + durationMs;
  const handle = setTimeout(async () => {
    activeTimers.delete(roomId);
    try {
      await onExpire();
    } catch (err) {
      logger.error({ err, roomId }, 'Error in game phase expiry handler');
    }
  }, durationMs);

  activeTimers.set(roomId, { timeoutHandle: handle, phaseEndsAt });
  return phaseEndsAt;
}

function clearPhaseTimer(roomId) {
  const existing = activeTimers.get(roomId);
  if (existing) {
    clearTimeout(existing.timeoutHandle);
    activeTimers.delete(roomId);
  }
}

function getPhaseEndsAt(roomId) {
  return activeTimers.get(roomId)?.phaseEndsAt || null;
}

module.exports = { schedulePhaseEnd, clearPhaseTimer, getPhaseEndsAt };
