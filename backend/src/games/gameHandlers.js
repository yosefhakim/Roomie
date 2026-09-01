'use strict';

const { z } = require('zod');
const roomService = require('../services/roomService');
const gameSessionService = require('../services/gameSessionService');
const gameTimer = require('./gameTimer');
const spyEngine = require('./spy/spyEngine');
const mafiaEngine = require('./mafia/mafiaEngine');
const drawGuessEngine = require('./drawguess/drawGuessEngine');
const { withRateLimit } = require('../middleware/socketRateLimit');
const { validate } = require('../utils/schemas');
const logger = require('../config/logger').child({ module: 'gameHandlers' });

const GAME_TYPES = Object.freeze({ SPY: 'spy', MAFIA: 'mafia', DRAW_GUESS: 'draw_guess' });

/**
 * Broadcasts the current game state to every member of the room, with
 * PER-PLAYER REDACTION: each connected socket receives a payload tailored
 * to what that specific player is allowed to know (their own secret
 * role/word, hidden from everyone else). This is why we can't just
 * `io.to(roomId).emit(...)` once with a single payload - we iterate
 * connected sockets and emit individually. This is the crux of making the
 * game "server-authoritative": the server decides what each client is
 * permitted to see, and the client has no way to obtain hidden information
 * on its own.
 */
async function broadcastGameState(io, roomId, session, redactFn) {
  const room = await roomService.getRoomState(roomId);
  if (!room) return;

  for (const member of room.members) {
    const socketId = await roomService.getSocketForUser({ roomId, userId: member.userId });
    if (!socketId) continue;
    const redacted = redactFn(session.state, member.userId);
    io.to(socketId).emit('game:state', {
      roomId,
      gameType: session.gameType,
      phase: session.phase,
      phaseEndsAt: session.phaseEndsAt,
      state: redacted,
    });
  }
}

// ---------------------------------------------------------------------------
// Spy game phase orchestration
// ---------------------------------------------------------------------------

async function spyAdvanceToVoting(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = spyEngine.startVoting(session.state);
    return { state, phase: spyEngine.PHASES.VOTING, phaseEndsAt: null };
  });
  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, spyEngine.VOTING_DURATION_MS, () => spyResolveVotes(io, roomId));
  const final = await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
  await broadcastGameState(io, roomId, final, spyEngine.redactStateForPlayer);
}

async function spyResolveVotes(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = spyEngine.resolveVotes(session.state);
    return { state, phase: state.phase, phaseEndsAt: null };
  });

  await broadcastGameState(io, roomId, updated, spyEngine.redactStateForPlayer);

  if (updated.phase === spyEngine.PHASES.ENDED) {
    gameTimer.clearPhaseTimer(roomId);
    logger.info({ roomId, winner: updated.state.winner }, 'Spy game ended');
    return;
  }

  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, spyEngine.REVEAL_DURATION_MS, () => spyStartDescribing(io, roomId));
  await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
}

async function spyStartDescribing(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = spyEngine.startDescribing(session.state);
    return { state, phase: spyEngine.PHASES.DESCRIBING, phaseEndsAt: null };
  });
  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, spyEngine.DESCRIBING_DURATION_MS, () => spyAdvanceToVoting(io, roomId));
  const final = await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
  await broadcastGameState(io, roomId, final, spyEngine.redactStateForPlayer);
}

// ---------------------------------------------------------------------------
// Mafia game phase orchestration
// ---------------------------------------------------------------------------

async function mafiaResolveNight(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = mafiaEngine.resolveNight(session.state);
    return { state, phase: state.phase, phaseEndsAt: null };
  });
  await broadcastGameState(io, roomId, updated, mafiaEngine.redactStateForPlayer);

  if (updated.phase === mafiaEngine.PHASES.ENDED) {
    gameTimer.clearPhaseTimer(roomId);
    logger.info({ roomId, winner: updated.state.winner }, 'Mafia game ended');
    return;
  }

  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, mafiaEngine.DAY_DISCUSSION_DURATION_MS, () => mafiaStartDayVoting(io, roomId));
  await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
}

async function mafiaStartDayVoting(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = mafiaEngine.startDayVoting(session.state);
    return { state, phase: mafiaEngine.PHASES.DAY_VOTING, phaseEndsAt: null };
  });
  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, mafiaEngine.DAY_VOTING_DURATION_MS, () => mafiaResolveDayVote(io, roomId));
  const final = await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
  await broadcastGameState(io, roomId, final, mafiaEngine.redactStateForPlayer);
}

async function mafiaResolveDayVote(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = mafiaEngine.resolveDayVote(session.state);
    return { state, phase: state.phase, phaseEndsAt: null };
  });
  await broadcastGameState(io, roomId, updated, mafiaEngine.redactStateForPlayer);

  if (updated.phase === mafiaEngine.PHASES.ENDED) {
    gameTimer.clearPhaseTimer(roomId);
    logger.info({ roomId, winner: updated.state.winner }, 'Mafia game ended');
    return;
  }

  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, mafiaEngine.DAY_REVEAL_DURATION_MS, () => mafiaStartNight(io, roomId));
  await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
}

async function mafiaStartNight(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = mafiaEngine.startNight(session.state);
    return { state, phase: mafiaEngine.PHASES.NIGHT, phaseEndsAt: null };
  });
  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, mafiaEngine.NIGHT_DURATION_MS, () => mafiaResolveNight(io, roomId));
  const final = await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
  await broadcastGameState(io, roomId, final, mafiaEngine.redactStateForPlayer);
}

// ---------------------------------------------------------------------------
// Draw & Guess phase orchestration
// ---------------------------------------------------------------------------

async function dgAdvanceRound(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = drawGuessEngine.startNextRound(session.state);
    return { state, phase: state.phase, phaseEndsAt: null };
  });
  await broadcastGameState(io, roomId, updated, drawGuessEngine.redactStateForPlayer);

  if (updated.phase === drawGuessEngine.PHASES.ENDED) {
    gameTimer.clearPhaseTimer(roomId);
    logger.info({ roomId, winner: updated.state.winner }, 'Draw & Guess game ended');
    return;
  }

  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, drawGuessEngine.WORD_SELECTION_DURATION_MS, () =>
    dgForceWordSelectionTimeout(io, roomId)
  );
  await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
}

/** If the drawer doesn't pick within the time limit, auto-pick the first option. */
async function dgForceWordSelectionTimeout(io, roomId) {
  const session = await gameSessionService.getSession(roomId);
  if (!session || session.phase !== drawGuessEngine.PHASES.WORD_SELECTION) return;
  const drawerId = session.state.drawOrder[session.state.currentDrawerIndex];
  await dgSelectWord(io, roomId, drawerId, session.state.wordOptions[0]);
}

async function dgSelectWord(io, roomId, drawerId, word) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = drawGuessEngine.selectWord(session.state, drawerId, word);
    return { state, phase: drawGuessEngine.PHASES.DRAWING, phaseEndsAt: null };
  });
  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, drawGuessEngine.DRAWING_DURATION_MS, () => dgEndRound(io, roomId));
  const final = await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
  await broadcastGameState(io, roomId, final, drawGuessEngine.redactStateForPlayer);
}

async function dgEndRound(io, roomId) {
  const updated = await gameSessionService.updateSessionWithRetry(roomId, (session) => {
    const state = drawGuessEngine.endRound(session.state);
    return { state, phase: drawGuessEngine.PHASES.ROUND_END, phaseEndsAt: null };
  });
  await broadcastGameState(io, roomId, updated, drawGuessEngine.redactStateForPlayer);

  const phaseEndsAt = gameTimer.schedulePhaseEnd(roomId, drawGuessEngine.ROUND_END_DURATION_MS, () => dgAdvanceRound(io, roomId));
  await gameSessionService.updateSession(roomId, (s) => ({ state: s.state, phase: s.phase, phaseEndsAt }));
}

// ---------------------------------------------------------------------------
// Socket event registration
// ---------------------------------------------------------------------------

const startGamePayload = z.object({
  roomId: z.string().uuid(),
  gameType: z.enum(['spy', 'mafia', 'draw_guess']),
});
const gameActionPayload = z.object({
  roomId: z.string().uuid(),
  targetId: z.string().min(1).optional(),
  word: z.string().min(1).max(40).optional(),
  guess: z.string().min(1).max(60).optional(),
});
const mafiaNightActionPayload = gameActionPayload.extend({
  actionType: z.enum(['mafia_vote', 'detective_check', 'doctor_protect']),
});
const drawStrokePayload = z.object({
  roomId: z.string().uuid(),
  // Stroke point data is opaque to the server by design - see the header
  // comment in drawGuessEngine.js for why canvas data is relayed, not
  // interpreted as game state.
  stroke: z.any(),
});

function registerGameHandlers(io, socket) {
  const userId = socket.data.userId;

  socket.on(
    'game:start',
    withRateLimit('game:start', async (socket, rawPayload, ack) => {
      const payload = validate(startGamePayload, rawPayload);
      const room = await roomService.getRoomState(payload.roomId);
      if (!room) throw Object.assign(new Error('Room not found'), { code: 'ROOM_NOT_FOUND' });
      if (room.ownerId !== userId) {
        throw Object.assign(new Error('Only the room owner can start a game'), { code: 'FORBIDDEN' });
      }

      const playerIds = room.members.map((m) => m.userId);
      let initialState;
      let engine;
      if (payload.gameType === 'spy') {
        engine = spyEngine;
        initialState = spyEngine.createInitialState({ playerIds });
      } else if (payload.gameType === 'mafia') {
        engine = mafiaEngine;
        initialState = mafiaEngine.createInitialState({ playerIds });
      } else {
        engine = drawGuessEngine;
        initialState = drawGuessEngine.createInitialState({ playerIds });
      }

      await gameSessionService.createSession({
        roomId: payload.roomId,
        gameType: payload.gameType,
        initialState,
        initialPhase: engine.PHASES.LOBBY,
      });

      safeAck(ack, { ok: true });

      if (payload.gameType === 'spy') await spyStartDescribing(io, payload.roomId);
      else if (payload.gameType === 'mafia') await mafiaStartNight(io, payload.roomId);
      else await dgAdvanceRound(io, payload.roomId);
    })
  );

  socket.on(
    'game:spy:describe',
    withRateLimit('game:spy:describe', async (socket, rawPayload, ack) => {
      const payload = validate(gameActionPayload, rawPayload);
      let allDone = false;
      const updated = await gameSessionService.updateSessionWithRetry(payload.roomId, (session) => {
        const result = spyEngine.submitDescription(session.state, userId);
        allDone = result.allDone;
        return { state: result.state, phase: session.phase, phaseEndsAt: session.phaseEndsAt };
      });
      safeAck(ack, { ok: true });
      await broadcastGameState(io, payload.roomId, updated, spyEngine.redactStateForPlayer);

      if (allDone) {
        gameTimer.clearPhaseTimer(payload.roomId);
        await spyAdvanceToVoting(io, payload.roomId);
      }
    })
  );

  socket.on(
    'game:spy:vote',
    withRateLimit('game:spy:vote', async (socket, rawPayload, ack) => {
      const payload = validate(gameActionPayload, rawPayload);
      let allVoted = false;
      const updated = await gameSessionService.updateSessionWithRetry(payload.roomId, (session) => {
        const result = spyEngine.submitVote(session.state, userId, payload.targetId);
        allVoted = result.allVoted;
        return { state: result.state, phase: session.phase, phaseEndsAt: session.phaseEndsAt };
      });
      safeAck(ack, { ok: true });
      await broadcastGameState(io, payload.roomId, updated, spyEngine.redactStateForPlayer);

      if (allVoted) {
        gameTimer.clearPhaseTimer(payload.roomId);
        await spyResolveVotes(io, payload.roomId);
      }
    })
  );

  socket.on(
    'game:mafia:nightAction',
    withRateLimit('game:mafia:nightAction', async (socket, rawPayload, ack) => {
      const payload = validate(mafiaNightActionPayload, rawPayload);
      const updated = await gameSessionService.updateSessionWithRetry(payload.roomId, (session) => {
        let state;
        if (payload.actionType === 'mafia_vote') state = mafiaEngine.submitMafiaVote(session.state, userId, payload.targetId);
        else if (payload.actionType === 'detective_check') state = mafiaEngine.submitDetectiveCheck(session.state, userId, payload.targetId);
        else state = mafiaEngine.submitDoctorProtect(session.state, userId, payload.targetId);
        return { state, phase: session.phase, phaseEndsAt: session.phaseEndsAt };
      });
      safeAck(ack, { ok: true });
      await broadcastGameState(io, payload.roomId, updated, mafiaEngine.redactStateForPlayer);
    })
  );

  socket.on(
    'game:mafia:dayVote',
    withRateLimit('game:mafia:dayVote', async (socket, rawPayload, ack) => {
      const payload = validate(gameActionPayload, rawPayload);
      let allVoted = false;
      const updated = await gameSessionService.updateSessionWithRetry(payload.roomId, (session) => {
        const result = mafiaEngine.submitDayVote(session.state, userId, payload.targetId);
        allVoted = result.allVoted;
        return { state: result.state, phase: session.phase, phaseEndsAt: session.phaseEndsAt };
      });
      safeAck(ack, { ok: true });
      await broadcastGameState(io, payload.roomId, updated, mafiaEngine.redactStateForPlayer);

      if (allVoted) {
        gameTimer.clearPhaseTimer(payload.roomId);
        await mafiaResolveDayVote(io, payload.roomId);
      }
    })
  );

  socket.on(
    'game:drawguess:selectWord',
    withRateLimit('game:drawguess:selectWord', async (socket, rawPayload, ack) => {
      const payload = validate(gameActionPayload, rawPayload);
      gameTimer.clearPhaseTimer(payload.roomId);
      await dgSelectWord(io, payload.roomId, userId, payload.word);
      safeAck(ack, { ok: true });
    })
  );

  socket.on(
    'game:drawguess:guess',
    withRateLimit('game:drawguess:guess', async (socket, rawPayload, ack) => {
      const payload = validate(gameActionPayload, rawPayload);
      let outcome;
      const updated = await gameSessionService.updateSessionWithRetry(payload.roomId, (session) => {
        const result = drawGuessEngine.submitGuess(session.state, userId, payload.guess);
        outcome = result;
        return { state: result.state, phase: session.phase, phaseEndsAt: session.phaseEndsAt };
      });
      safeAck(ack, { ok: true, correct: outcome.correct, pointsAwarded: outcome.pointsAwarded });
      await broadcastGameState(io, payload.roomId, updated, drawGuessEngine.redactStateForPlayer);

      if (outcome.correct) {
        io.to(payload.roomId).emit('game:drawguess:correctGuess', { userId, pointsAwarded: outcome.pointsAwarded });
      }

      if (outcome.roundComplete) {
        gameTimer.clearPhaseTimer(payload.roomId);
        await dgEndRound(io, payload.roomId);
      }
    })
  );

  // Canvas stroke relay - intentionally bypasses gameSessionService/Redis
  // entirely (see rationale in drawGuessEngine.js header comment). Pure
  // fan-out: the drawer's client sends stroke data, the server relays it to
  // everyone else in the room verbatim. No game-logic validation of stroke
  // content - that's a client-rendering concern, not game state.
  socket.on('game:draw:stroke', (rawPayload) => {
    try {
      const payload = validate(drawStrokePayload, rawPayload);
      socket.to(payload.roomId).emit('game:draw:stroke', { userId, stroke: payload.stroke });
    } catch (err) {
      logger.warn({ err: err.message, userId }, 'Dropped malformed draw stroke payload');
    }
  });

  socket.on('game:draw:clear', (rawPayload) => {
    const parsed = z.object({ roomId: z.string().uuid() }).safeParse(rawPayload);
    if (parsed.success) {
      socket.to(parsed.data.roomId).emit('game:draw:clear', { userId });
    }
  });
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

module.exports = { registerGameHandlers, GAME_TYPES };
