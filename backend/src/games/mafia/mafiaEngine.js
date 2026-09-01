'use strict';

/**
 * Mafia/Werewolf - game flow:
 *   lobby -> night -> day_discussion -> day_voting -> day_reveal -> (night -> ...) -> ended
 *
 * Roles: mafia, detective, doctor, villager.
 * - Role counts scale with player count (see computeRoleDistribution).
 * - `night`: mafia collectively choose a kill target; detective checks one
 *   player's alignment; doctor chooses one player to protect. All three
 *   actions are collected during the same night phase and resolved together
 *   when the phase ends.
 * - `day_discussion`: free discussion (voice chat, Layer 6) - timer only,
 *   no server-tracked actions.
 * - `day_voting`: everyone alive votes to eliminate a suspected mafia
 *   member.
 * - `day_reveal`: elimination announced, win condition checked.
 *
 * Win conditions: mafia win if mafia count >= villager-aligned count;
 * villagers (+detective+doctor) win if all mafia are eliminated.
 *
 * Same design principle as spyEngine.js: pure functions, no I/O.
 */

const PHASES = Object.freeze({
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY_DISCUSSION: 'day_discussion',
  DAY_VOTING: 'day_voting',
  DAY_REVEAL: 'day_reveal',
  ENDED: 'ended',
});

const ROLES = Object.freeze({
  MAFIA: 'mafia',
  DETECTIVE: 'detective',
  DOCTOR: 'doctor',
  VILLAGER: 'villager',
});

const NIGHT_DURATION_MS = 30_000;
const DAY_DISCUSSION_DURATION_MS = 60_000;
const DAY_VOTING_DURATION_MS = 30_000;
const DAY_REVEAL_DURATION_MS = 8_000;

/**
 * Scales mafia count with lobby size (roughly 1 mafia per 4 players, min 1),
 * always includes exactly one detective and one doctor if there are enough
 * players to spare, fills the rest with villagers.
 */
function computeRoleDistribution(playerCount) {
  if (playerCount < 4) {
    const err = new Error('Mafia requires at least 4 players');
    err.code = 'NOT_ENOUGH_PLAYERS';
    throw err;
  }
  const mafiaCount = Math.max(1, Math.floor(playerCount / 4));
  const includeDetective = playerCount >= 5;
  const includeDoctor = playerCount >= 6;

  const roles = [];
  for (let i = 0; i < mafiaCount; i++) roles.push(ROLES.MAFIA);
  if (includeDetective) roles.push(ROLES.DETECTIVE);
  if (includeDoctor) roles.push(ROLES.DOCTOR);
  while (roles.length < playerCount) roles.push(ROLES.VILLAGER);

  return roles;
}

function createInitialState({ playerIds }) {
  const roles = computeRoleDistribution(playerIds.length).sort(() => Math.random() - 0.5);
  const players = {};
  playerIds.forEach((id, i) => {
    players[id] = { id, role: roles[i], alive: true };
  });

  return {
    phase: PHASES.LOBBY,
    round: 0,
    players,
    nightActions: { mafiaVotes: {}, detectiveCheck: null, doctorProtect: null },
    dayVotes: {},
    eliminationHistory: [],
    lastNightResult: null,
    detectiveResults: {},
    winner: null,
  };
}

function alivePlayers(state) {
  return Object.values(state.players).filter((p) => p.alive);
}
function aliveMafiaCount(state) {
  return alivePlayers(state).filter((p) => p.role === ROLES.MAFIA).length;
}
function aliveVillageCount(state) {
  return alivePlayers(state).filter((p) => p.role !== ROLES.MAFIA).length;
}

function startNight(state) {
  return {
    ...state,
    phase: PHASES.NIGHT,
    round: state.round + 1,
    nightActions: { mafiaVotes: {}, detectiveCheck: null, doctorProtect: null },
  };
}

function submitMafiaVote(state, mafiaPlayerId, targetId) {
  assertPhase(state, PHASES.NIGHT);
  assertRole(state, mafiaPlayerId, ROLES.MAFIA);
  assertAliveTarget(state, targetId);

  const nightActions = {
    ...state.nightActions,
    mafiaVotes: { ...state.nightActions.mafiaVotes, [mafiaPlayerId]: targetId },
  };
  return { ...state, nightActions };
}

function submitDetectiveCheck(state, detectivePlayerId, targetId) {
  assertPhase(state, PHASES.NIGHT);
  assertRole(state, detectivePlayerId, ROLES.DETECTIVE);
  assertAliveTarget(state, targetId);

  const nightActions = { ...state.nightActions, detectiveCheck: { detectivePlayerId, targetId } };
  return { ...state, nightActions };
}

function submitDoctorProtect(state, doctorPlayerId, targetId) {
  assertPhase(state, PHASES.NIGHT);
  assertRole(state, doctorPlayerId, ROLES.DOCTOR);
  assertAliveTarget(state, targetId);

  const nightActions = { ...state.nightActions, doctorProtect: targetId };
  return { ...state, nightActions };
}

/**
 * Resolves all night actions collected so far: tallies mafia votes (highest
 * wins, no vote = no kill attempt), applies doctor protection, records the
 * detective's result. Transitions to DAY_DISCUSSION (or ENDED if this
 * resolves the game).
 */
function resolveNight(state) {
  const { mafiaVotes, detectiveCheck, doctorProtect } = state.nightActions;

  const tally = {};
  for (const targetId of Object.values(mafiaVotes)) tally[targetId] = (tally[targetId] || 0) + 1;
  let killTargetId = null;
  let maxVotes = 0;
  for (const [targetId, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count;
      killTargetId = targetId;
    }
  }

  const wasProtected = Boolean(killTargetId && doctorProtect === killTargetId);
  const actuallyKilled = killTargetId && !wasProtected;

  let players = state.players;
  let eliminationHistory = state.eliminationHistory;
  if (actuallyKilled) {
    players = { ...state.players, [killTargetId]: { ...state.players[killTargetId], alive: false } };
    eliminationHistory = [
      ...state.eliminationHistory,
      { round: state.round, playerId: killTargetId, role: state.players[killTargetId].role, cause: 'mafia_kill' },
    ];
  }

  let detectiveResults = state.detectiveResults;
  if (detectiveCheck) {
    const { detectivePlayerId, targetId } = detectiveCheck;
    const isMafia = state.players[targetId].role === ROLES.MAFIA;
    const existing = detectiveResults[detectivePlayerId] || [];
    detectiveResults = {
      ...detectiveResults,
      [detectivePlayerId]: [...existing, { round: state.round, targetId, isMafia }],
    };
  }

  const nextState = {
    ...state,
    players,
    eliminationHistory,
    detectiveResults,
    lastNightResult: { killedId: actuallyKilled ? killTargetId : null, wasProtected },
  };

  const winner = evaluateWinner(nextState);
  return { ...nextState, winner, phase: winner ? PHASES.ENDED : PHASES.DAY_DISCUSSION };
}

function startDayVoting(state) {
  assertPhase(state, PHASES.DAY_DISCUSSION);
  return { ...state, phase: PHASES.DAY_VOTING, dayVotes: {} };
}

function submitDayVote(state, voterId, targetId) {
  assertPhase(state, PHASES.DAY_VOTING);
  if (!state.players[voterId]?.alive) {
    const err = new Error('Eliminated players cannot vote');
    err.code = 'PLAYER_ELIMINATED';
    throw err;
  }
  assertAliveTarget(state, targetId);

  const dayVotes = { ...state.dayVotes, [voterId]: targetId };
  const allVoted = alivePlayers(state).every((p) => dayVotes[p.id]);
  return { state: { ...state, dayVotes }, allVoted };
}

function resolveDayVote(state) {
  const tally = {};
  for (const targetId of Object.values(state.dayVotes)) tally[targetId] = (tally[targetId] || 0) + 1;

  let eliminatedId = null;
  let maxVotes = -1;
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
      { round: state.round, playerId: eliminatedId, role: state.players[eliminatedId].role, cause: 'day_vote' },
    ];
  }

  const nextState = { ...state, players, eliminationHistory };
  const winner = evaluateWinner(nextState);
  return { ...nextState, winner, phase: winner ? PHASES.ENDED : PHASES.DAY_REVEAL };
}

function evaluateWinner(state) {
  const mafiaLeft = aliveMafiaCount(state);
  const villageLeft = aliveVillageCount(state);
  if (mafiaLeft === 0) return 'villagers';
  if (mafiaLeft >= villageLeft) return 'mafia';
  return null;
}

function assertPhase(state, expected) {
  if (state.phase !== expected) {
    const err = new Error(`Expected phase ${expected}, got ${state.phase}`);
    err.code = 'WRONG_PHASE';
    throw err;
  }
}
function assertRole(state, playerId, expectedRole) {
  const player = state.players[playerId];
  if (!player || !player.alive) {
    const err = new Error('Player not found or not alive');
    err.code = 'PLAYER_ELIMINATED';
    throw err;
  }
  if (player.role !== expectedRole) {
    const err = new Error(`Player does not have role ${expectedRole}`);
    err.code = 'WRONG_ROLE';
    throw err;
  }
}
function assertAliveTarget(state, targetId) {
  if (!state.players[targetId]?.alive) {
    const err = new Error('Target is not alive');
    err.code = 'INVALID_TARGET';
    throw err;
  }
}

/**
 * Redacts state for a given player: own role always visible; other living
 * players' roles hidden until game end, EXCEPT mafia players see each
 * other (classic Mafia/Werewolf information asymmetry), and a detective
 * sees their own accumulated check results.
 */
function redactStateForPlayer(state, playerId) {
  const revealAll = state.phase === PHASES.ENDED;
  const viewer = state.players[playerId];
  const viewerIsMafia = viewer?.role === ROLES.MAFIA;

  const players = Object.fromEntries(
    Object.entries(state.players).map(([id, p]) => {
      const canSeeRole = revealAll || id === playerId || (viewerIsMafia && p.role === ROLES.MAFIA) || !p.alive;
      return [id, { id: p.id, alive: p.alive, role: canSeeRole ? p.role : undefined }];
    })
  );

  return {
    phase: state.phase,
    round: state.round,
    players,
    myRole: viewer?.role,
    detectiveResults: viewer?.role === ROLES.DETECTIVE ? state.detectiveResults[playerId] || [] : undefined,
    lastNightResult: state.phase !== PHASES.NIGHT ? state.lastNightResult : null,
    dayVoteCount: Object.keys(state.dayVotes).length,
    myDayVote: state.dayVotes[playerId] || null,
    nightActionSubmitted: {
      mafiaVote: viewerIsMafia ? Boolean(state.nightActions.mafiaVotes[playerId]) : undefined,
      detectiveCheck: viewer?.role === ROLES.DETECTIVE ? Boolean(state.nightActions.detectiveCheck) : undefined,
      doctorProtect: viewer?.role === ROLES.DOCTOR ? Boolean(state.nightActions.doctorProtect) : undefined,
    },
    eliminationHistory: state.eliminationHistory,
    winner: state.winner,
  };
}

module.exports = {
  PHASES,
  ROLES,
  NIGHT_DURATION_MS,
  DAY_DISCUSSION_DURATION_MS,
  DAY_VOTING_DURATION_MS,
  DAY_REVEAL_DURATION_MS,
  computeRoleDistribution,
  createInitialState,
  startNight,
  submitMafiaVote,
  submitDetectiveCheck,
  submitDoctorProtect,
  resolveNight,
  startDayVoting,
  submitDayVote,
  resolveDayVote,
  redactStateForPlayer,
  alivePlayers,
  aliveMafiaCount,
  aliveVillageCount,
};
