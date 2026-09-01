'use strict';

/**
 * Draw & Guess - game flow:
 *   lobby -> word_selection -> drawing -> round_end -> (word_selection -> ...) -> ended
 *
 * - `word_selection`: the current drawer picks 1 of 3 offered words
 *   (server-generated, not client-supplied, to prevent cheating by picking
 *   an easy custom word).
 * - `drawing`: the drawer emits canvas stroke events (relayed live, not
 *   stored authoritatively here - see the comment below); other players
 *   submit guesses. First correct guesser gets the most points; later
 *   correct guessers get progressively fewer. The drawer earns points
 *   proportional to how many players guessed correctly.
 * - `round_end`: reveals the word, shows round scoring, advances to the
 *   next drawer in rotation.
 * - Game ends after every player has drawn `roundsPerPlayer` times (default 1).
 *
 * Canvas strokes themselves are NOT persisted in this state machine - they
 * are relayed live, drawer-to-room, via a dedicated socket event
 * (`game:draw:stroke`, see gameHandlers.js) that bypasses the CAS-versioned
 * game session entirely. Storing every stroke in the versioned session
 * would make the session enormous and contend the CAS lock on every
 * mouse-move; strokes are inherently ephemeral broadcast data, not state
 * that needs to survive a reconnect with full fidelity (a reconnecting
 * client just sees the canvas from wherever it currently is).
 */

const PHASES = Object.freeze({
  LOBBY: 'lobby',
  WORD_SELECTION: 'word_selection',
  DRAWING: 'drawing',
  ROUND_END: 'round_end',
  ENDED: 'ended',
});

const WORD_SELECTION_DURATION_MS = 12_000;
const DRAWING_DURATION_MS = 75_000;
const ROUND_END_DURATION_MS = 8_000;

const GUESS_WORD_POOL = [
  'Elephant', 'Guitar', 'Rainbow', 'Sandwich', 'Rocket', 'Umbrella', 'Castle', 'Dragon',
  'Bicycle', 'Volcano', 'Penguin', 'Lighthouse', 'Robot', 'Butterfly', 'Pirate', 'Snowman',
  'Octopus', 'Waterfall', 'Dinosaur', 'Skateboard', 'Telescope', 'Campfire', 'Kangaroo', 'Violin',
];

function pickWordOptions(excludeWords = []) {
  const available = GUESS_WORD_POOL.filter((w) => !excludeWords.includes(w));
  const pool = available.length >= 3 ? available : GUESS_WORD_POOL;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function createInitialState({ playerIds, roundsPerPlayer = 1 }) {
  if (playerIds.length < 2) {
    const err = new Error('Draw & Guess requires at least 2 players');
    err.code = 'NOT_ENOUGH_PLAYERS';
    throw err;
  }

  const players = {};
  for (const id of playerIds) players[id] = { id, score: 0, roundsDrawn: 0 };

  return {
    phase: PHASES.LOBBY,
    round: 0,
    drawOrder: [...playerIds],
    currentDrawerIndex: -1,
    roundsPerPlayer,
    players,
    currentWord: null,
    wordOptions: [],
    usedWords: [],
    correctGuessers: [],
    guessedThisRound: {},
    lastRoundSummary: null,
    winner: null,
  };
}

function startNextRound(state) {
  const nextDrawerIndex = (state.currentDrawerIndex + 1) % state.drawOrder.length;

  // Game ends once every player has had their allotted number of turns as
  // drawer. Tracked via a simple total-turns counter rather than
  // per-player bookkeeping gymnastics.
  const totalTurnsTaken = state.round;
  const totalTurnsAllowed = state.drawOrder.length * state.roundsPerPlayer;
  if (totalTurnsTaken >= totalTurnsAllowed) {
    return resolveGame(state);
  }

  return {
    ...state,
    phase: PHASES.WORD_SELECTION,
    round: state.round + 1,
    currentDrawerIndex: nextDrawerIndex,
    currentWord: null,
    wordOptions: pickWordOptions(state.usedWords),
    correctGuessers: [],
    guessedThisRound: {},
  };
}

function selectWord(state, drawerId, chosenWord) {
  const expectedDrawerId = state.drawOrder[state.currentDrawerIndex];
  if (drawerId !== expectedDrawerId) {
    const err = new Error('Only the current drawer can select the word');
    err.code = 'NOT_YOUR_TURN';
    throw err;
  }
  if (!state.wordOptions.includes(chosenWord)) {
    const err = new Error('Word must be one of the offered options');
    err.code = 'INVALID_WORD_CHOICE';
    throw err;
  }

  return {
    ...state,
    phase: PHASES.DRAWING,
    currentWord: chosenWord,
    usedWords: [...state.usedWords, chosenWord],
  };
}

// Points awarded scale down for later correct guessers, rewarding speed.
const GUESS_POINTS_BY_ORDER = [100, 80, 60, 40, 20];
const MIN_GUESS_POINTS = 10;

/**
 * Submits a guess. Returns `{ state, correct, pointsAwarded }`. Guessing is
 * case-insensitive and trims whitespace; the drawer cannot guess their own
 * word. Repeat correct guesses by the same player in the same round are
 * ignored (already scored).
 */
function submitGuess(state, guesserId, guessText) {
  if (state.phase !== PHASES.DRAWING) {
    const err = new Error('Not in drawing phase');
    err.code = 'WRONG_PHASE';
    throw err;
  }
  const drawerId = state.drawOrder[state.currentDrawerIndex];
  if (guesserId === drawerId) {
    const err = new Error('The drawer cannot guess');
    err.code = 'DRAWER_CANNOT_GUESS';
    throw err;
  }
  if (state.guessedThisRound[guesserId]) {
    return { state, correct: false, alreadyGuessed: true, pointsAwarded: 0 };
  }

  const normalize = (s) => s.trim().toLowerCase();
  const correct = normalize(guessText) === normalize(state.currentWord);

  if (!correct) {
    return { state, correct: false, pointsAwarded: 0 };
  }

  const order = state.correctGuessers.length;
  const pointsAwarded = GUESS_POINTS_BY_ORDER[order] ?? MIN_GUESS_POINTS;

  const players = {
    ...state.players,
    [guesserId]: { ...state.players[guesserId], score: state.players[guesserId].score + pointsAwarded },
  };
  const correctGuessers = [...state.correctGuessers, { playerId: guesserId, order, pointsAwarded }];
  const guessedThisRound = { ...state.guessedThisRound, [guesserId]: true };

  // Drawer earns 10 points per correct guesser as a shared incentive.
  const drawerBonus = 10;
  players[drawerId] = { ...players[drawerId], score: players[drawerId].score + drawerBonus };

  const allNonDrawersGuessed = Object.keys(state.players).length - 1 === correctGuessers.length;

  return {
    state: { ...state, players, correctGuessers, guessedThisRound },
    correct: true,
    pointsAwarded,
    roundComplete: allNonDrawersGuessed,
  };
}

function endRound(state) {
  const drawerId = state.drawOrder[state.currentDrawerIndex];
  const players = {
    ...state.players,
    [drawerId]: { ...state.players[drawerId], roundsDrawn: state.players[drawerId].roundsDrawn + 1 },
  };

  return {
    ...state,
    players,
    phase: PHASES.ROUND_END,
    lastRoundSummary: {
      word: state.currentWord,
      drawerId,
      correctGuessers: state.correctGuessers,
    },
  };
}

function resolveGame(state) {
  const scores = Object.values(state.players);
  const maxScore = Math.max(...scores.map((p) => p.score));
  const topScorers = scores.filter((p) => p.score === maxScore);
  // A tie at the top means no single winner - client displays all tied
  // top-scorers rather than the server picking arbitrarily.
  const winner = topScorers.length === 1 ? topScorers[0].id : null;

  return { ...state, phase: PHASES.ENDED, winner };
}

/**
 * Redacts state for a given player: the word itself is hidden from
 * everyone except the drawer during the drawing phase (guessers must not
 * see it in their state payload, or the game is trivially cheatable).
 * Revealed to everyone at round_end/ended.
 */
function redactStateForPlayer(state, playerId) {
  const drawerId = state.drawOrder[state.currentDrawerIndex];
  const isDrawer = playerId === drawerId;
  const wordVisible = isDrawer || state.phase === PHASES.ROUND_END || state.phase === PHASES.ENDED;

  return {
    phase: state.phase,
    round: state.round,
    totalRounds: state.drawOrder.length * state.roundsPerPlayer,
    drawerId,
    isDrawer,
    wordOptions: isDrawer && state.phase === PHASES.WORD_SELECTION ? state.wordOptions : undefined,
    currentWord: wordVisible ? state.currentWord : undefined,
    // Word length hint lets non-drawers see blanks ("_ _ _ _ _") without
    // the letters - standard Draw & Guess UX.
    wordLength: !wordVisible && state.currentWord ? state.currentWord.length : undefined,
    players: state.players,
    hasGuessedCorrectly: Boolean(state.guessedThisRound[playerId]),
    correctGuesserCount: state.correctGuessers.length,
    lastRoundSummary: state.lastRoundSummary,
    winner: state.winner,
  };
}

module.exports = {
  PHASES,
  WORD_SELECTION_DURATION_MS,
  DRAWING_DURATION_MS,
  ROUND_END_DURATION_MS,
  GUESS_WORD_POOL,
  pickWordOptions,
  createInitialState,
  startNextRound,
  selectWord,
  submitGuess,
  endRound,
  resolveGame,
  redactStateForPlayer,
};
