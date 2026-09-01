'use strict';

const { redisClient } = require('../config/redis');
const env = require('../config/env');
const logger = require('../config/logger').child({ module: 'gameSessionService' });

/**
 * Generic per-room game session envelope, shared across all game types
 * (Spy, Mafia, Draw & Guess). Each game module owns the shape of `state`
 * and `phaseEndsAt`; this module only owns the storage/locking mechanics
 * common to all of them:
 *
 *   game:{roomId}            HASH   { gameType, state (JSON), phase, phaseEndsAt, version }
 *
 * `version` is a simple optimistic-concurrency counter: every mutation
 * reads the current version, and the write is only committed via a Lua
 * script that checks the version hasn't changed since the read. This
 * matters because game state transitions (e.g. two players submitting a
 * vote at nearly the same moment) are exactly the kind of concurrent
 * read-modify-write that naive Redis usage gets wrong.
 */

function gameKey(roomId) {
  return `game:${roomId}`;
}

const CAS_WRITE_LUA = `
local key = KEYS[1]
local expectedVersion = ARGV[1]
local newStateJson = ARGV[2]
local newPhase = ARGV[3]
local newPhaseEndsAt = ARGV[4]
local newVersion = ARGV[5]
local ttl = tonumber(ARGV[6])

local currentVersion = redis.call('HGET', key, 'version')
if currentVersion ~= expectedVersion then
  return {err = 'VERSION_CONFLICT'}
end

redis.call('HSET', key, 'state', newStateJson, 'phase', newPhase, 'phaseEndsAt', newPhaseEndsAt, 'version', newVersion)
redis.call('EXPIRE', key, ttl)
return {ok = 'WRITTEN'}
`;

class GameSessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GameSessionError';
    this.code = code;
  }
}

async function createSession({ roomId, gameType, initialState, initialPhase, phaseEndsAt = null }) {
  const payload = {
    gameType,
    state: JSON.stringify(initialState),
    phase: initialPhase,
    phaseEndsAt: phaseEndsAt || '',
    version: '1',
  };
  await redisClient.hset(gameKey(roomId), payload);
  await redisClient.expire(gameKey(roomId), env.ROOM_INACTIVE_TTL_SECONDS);
  logger.info({ roomId, gameType, initialPhase }, 'Game session created');
  return getSession(roomId);
}

async function getSession(roomId) {
  const raw = await redisClient.hgetall(gameKey(roomId));
  if (!raw || Object.keys(raw).length === 0) return null;
  return {
    gameType: raw.gameType,
    state: JSON.parse(raw.state),
    phase: raw.phase,
    phaseEndsAt: raw.phaseEndsAt ? Number(raw.phaseEndsAt) : null,
    version: raw.version,
  };
}

/**
 * Compare-and-swap update. Caller passes a function that receives the
 * current session and returns `{ state, phase, phaseEndsAt }` describing
 * the new values. If another writer updated the session between our read
 * and write, this throws GameSessionError('VERSION_CONFLICT') and the
 * caller is expected to re-read and retry (game handlers do this with a
 * small bounded retry loop - see gameHandlers.js).
 */
async function updateSession(roomId, mutatorFn) {
  const current = await getSession(roomId);
  if (!current) throw new GameSessionError('SESSION_NOT_FOUND', `No game session for room ${roomId}`);

  const result = mutatorFn(current);
  const newVersion = String(Number(current.version) + 1);

  try {
    await redisClient.eval(
      CAS_WRITE_LUA,
      1,
      gameKey(roomId),
      current.version,
      JSON.stringify(result.state),
      result.phase,
      result.phaseEndsAt || '',
      newVersion,
      env.ROOM_INACTIVE_TTL_SECONDS
    );
  } catch (err) {
    if (err.message.includes('VERSION_CONFLICT')) {
      throw new GameSessionError('VERSION_CONFLICT', 'Game state was modified concurrently, retry');
    }
    throw err;
  }

  return { gameType: current.gameType, state: result.state, phase: result.phase, phaseEndsAt: result.phaseEndsAt, version: newVersion };
}

/**
 * Retries `updateSession` a few times on version conflicts, which are
 * expected under concurrent player actions (e.g. simultaneous votes) and
 * not actual errors - just a signal to re-read and reapply.
 */
async function updateSessionWithRetry(roomId, mutatorFn, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await updateSession(roomId, mutatorFn);
    } catch (err) {
      if (err.code !== 'VERSION_CONFLICT') throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

async function endSession(roomId) {
  await redisClient.del(gameKey(roomId));
  logger.info({ roomId }, 'Game session ended');
}

module.exports = {
  GameSessionError,
  createSession,
  getSession,
  updateSession,
  updateSessionWithRetry,
  endSession,
};
