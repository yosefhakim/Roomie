'use strict';

const { getRandomWordPair } = require('./wordPairs');

/**
 * Who's the Spy - game flow:
 *   lobby -> describing -> voting -> reveal -> (describing -> voting -> reveal)* -> ended
 *
 * - `describing`: each player in turn says one word/phrase describing their
 *   word (spies don't know they have the "wrong" word - they must bluff).
 *   The server doesn't validate speech content (that's voice chat, Layer 6)
 *   - this phase is purely a turn-order + timer construct.
 * - `voting`: every player votes for who they think the spy is.
 * - `reveal`: votes are tallied, the highest-voted player is eliminated and
 *   revealed as spy or civilian. Game continues if spies remain and
 *   civilians > spies; ends when either all spies are eliminated
 *   (civilians win) or spies >= civilians (spies win).
 *
 * All functions here are pure: (state, action) -> newState. No Redis, no
 * sockets, no timers - that I/O lives in gameHandlers.js, which is what
 * makes this file straightforward to unit test in isolation.
 */

const PHASES = Object.freeze({
  LOBBY: 'lobby',
  DESCRIBING: 'describing',
  VOTING: 'voting',
  REVEAL: 'reveal',
  ENDED: 'ended',
});

const DESCRIBING_DURATION_MS = 30_000;
const VOTING_DURATION_MS = 25_000;
const REVEAL_DURATION_MS = 8_000;

function createInitialState({ playerIds, spyCount = 1 }) {
  if (playerIds.length < 3) {
    const err = new Error("Who's the Spy requires at least 3 players");
    err.code = 'NOT_ENOUGH_PLAYERS';
    throw err;
  }
  if (spyCount >= playerIds.length / 2) {
    const err = new Error('Too many spies for this player count');
    err.code = 'TOO_MANY_SPIES';
    throw err;
  }

  const wordPair = getRandomWordPair();
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  const spyIds = new Set(shuffled.slice(0, spyCount));

  const players = {};
  for (const id of playerIds) {
    players[id] = {
      id,
      role: spyIds.has(id) ? 'spy' : 'civilian',
      word: spyIds.has(id) ? wordPair.spy : wordPair.civilian,
      alive: true,
      hasDescribed: false,
    };
  }

  return {
    phase: PHASES.LOBBY,
    round: 0,
    players,
    turnOrder: shuffled,
    currentTurnIndex: 0,
    votes: {}, // voterId -> targetId
    eliminationHistory: [], // [{ round, eliminatedId, role }]
    winner: null, // 'civilians' | 'spies' | null
  };
}

function alivePlayers(state) {
  return Object.values(state.players).filter((p) => p.alive);
}

function aliveSpyCount(state) {
  return alivePlayers(state).filter((p) => p.role === 'spy').length;
}

function aliveCivilianCount(state) {
  return alivePlayers(state).filter((p) => p.role === 'civilian').length;
}

function startDescribing(state) {
  const alive = alivePlayers(state);
  const players = { ...state.players };
  for (const p of alive) players[p.id] = { ...players[p.id], hasDescribed: false };
  return {
    ...state,
    players,
    phase: PHASES.DESCRIBING,
    round: state.round + 1,
    turnOrder: alive.map((p) => p.id),
    currentTurnIndex: 0,
  };
}

/**
 * Marks the current-turn player as having described, advances to the next
 * alive player's turn. Returns `{ state, allDone }` - caller (gameHandlers)
 * uses `allDone` to decide whether to transition to voting immediately
 * rather than waiting for the describing timer to expire.
 */
function submitDescription(state, playerId) {
  if (state.phase !== PHASES.DESCRIBING) {
    const err = new Error('Not in describing phase');
    err.code = 'WRONG_PHASE';
    throw err;
  }
  const currentTurnPlayerId = state.turnOrder[state.currentTurnIndex];
  if (playerId !== currentTurnPlayerId) {
    const err = new Error('Not your turn to describe');
    err.code = 'NOT_YOUR_TURN';
    throw err;
  }

  const players = { ...state.players, [playerId]: { ...state.players[playerId], hasDescribed: true } };
  const nextIndex = state.currentTurnIndex + 1;
  const allDone = nextIndex >= state.turnOrder.length;

  return {
    state: { ...state, players, currentTurnIndex: allDone ? state.currentTurnIndex : nextIndex },
    allDone,
  };
}

function startVoting(state) {
  return { ...state, phase: PHASES.VOTING, votes: {} };
}

function submitVote(state, voterId, targetId) {
  if (state.phase !== PHASES.VOTING) {
    const err = new Error('Not in voting phase');
    err.code = 'WRONG_PHASE';
    throw err;
  }
  if (!state.players[voterId]?.alive) {
    const err = new Error('Eliminated players cannot vote');
    err.code = 'PLAYER_ELIMINATED';
    throw err;
  }
  if (!state.players[targetId]?.alive) {
    const err = new Error('Cannot vote for an eliminated player');
    err.code = 'INVALID_VOTE_TARGET';
    throw err;
  }

  const votes = { ...state.votes, [voterId]: targetId };
  const allVoted = alivePlayers({ ...state, votes }).every((p) => votes[p.id]);
  return { state: { ...state, votes }, allVoted };
}

/**
 * Tallies votes, eliminates the highest-voted player (ties broken by
 * earliest-cast vote among the tied candidates, for determinism), and
 * evaluates win conditions. Returns the new state with phase = REVEAL or
 * ENDED depending on whether a winner is now decided.
 */
function resolveVotes(state) {
  const tally = {};
  for (const targetId of Object.values(state.votes)) {
    tally[targetId] = (tally[targetId] || 0) + 1;
  }

  let eliminatedId = null;
  let maxVotes = -1;
  // Object key insertion order for string keys follows insertion order in
  // JS, and votes were inserted in submission order, so this naturally
  // breaks ties by "first player to reach the max vote count."
  for (const [targetId, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminatedId = targetId;
    }
  }

  let players = state.players;
  let eliminationHistory = state.eliminationHistory;
  if (eliminatedId) {
    players = { ...state.players, [eliminatedId]: { ...state.players[eliminatedId], alive: false } };
    eliminationHistory = [
      ...state.eliminationHistory,
      { round: state.round, eliminatedId, role: state.players[eliminatedId].role },
    ];
  }

  const nextState = { ...state, players, eliminationHistory };

  const spiesLeft = aliveSpyCount(nextState);
  const civiliansLeft = aliveCivilianCount(nextState);

  let winner = null;
  if (spiesLeft === 0) winner = 'civilians';
  else if (spiesLeft >= civiliansLeft) winner = 'spies';

  return { ...nextState, winner, phase: winner ? PHASES.ENDED : PHASES.REVEAL };
}

/**
 * Redacts the full state down to what a specific player is allowed to see:
 * their own word/role always; other players' words/roles only after the
 * game has ended.
 */
function redactStateForPlayer(state, playerId) {
  const revealAll = state.phase === PHASES.ENDED;
  const players = Object.fromEntries(
    Object.entries(state.players).map(([id, p]) => [
      id,
      {
        id: p.id,
        alive: p.alive,
        hasDescribed: p.hasDescribed,
        role: revealAll || id === playerId ? p.role : undefined,
        word: revealAll || id === playerId ? p.word : undefined,
      },
    ])
  );

  return {
    phase: state.phase,
    round: state.round,
    players,
    turnOrder: state.turnOrder,
    currentTurnIndex: state.currentTurnIndex,
    currentTurnPlayerId: state.turnOrder[state.currentTurnIndex] || null,
    voteCount: Object.keys(state.votes).length,
    myVote: state.votes[playerId] || null,
    eliminationHistory: state.eliminationHistory,
    winner: state.winner,
  };
}

module.exports = {
  PHASES,
  DESCRIBING_DURATION_MS,
  VOTING_DURATION_MS,
  REVEAL_DURATION_MS,
  createInitialState,
  startDescribing,
  submitDescription,
  startVoting,
  submitVote,
  resolveVotes,
  redactStateForPlayer,
  alivePlayers,
  aliveSpyCount,
  aliveCivilianCount,
};
