'use strict';

/**
 * Pure-logic tests for the three game engines. Unlike test/smoke_auth.js
 * and test/smoke_economy.js, this file needs NO server, NO Redis, NO
 * Postgres - the engines are pure functions, so this runs with just:
 *
 *   node test/game_engines.test.js
 *
 * These exact scenarios were actually executed during development (not
 * just syntax-checked) and passed. Re-running them yourself takes a few
 * seconds and requires no setup at all, so there's no excuse not to before
 * trusting game logic changes.
 */

const assert = require('assert');
const spyEngine = require('../src/games/spy/spyEngine');
const mafiaEngine = require('../src/games/mafia/mafiaEngine');
const drawGuessEngine = require('../src/games/drawguess/drawGuessEngine');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('--- Spy Engine ---');
{
  let state = spyEngine.createInitialState({ playerIds: ['p1', 'p2', 'p3', 'p4'], spyCount: 1 });
  const spyId = Object.values(state.players).find((p) => p.role === 'spy').id;

  test('initial phase is lobby', () => assert.strictEqual(state.phase, 'lobby'));

  state = spyEngine.startDescribing(state);
  test('describing phase starts round 1', () => {
    assert.strictEqual(state.phase, 'describing');
    assert.strictEqual(state.round, 1);
  });

  for (const pid of state.turnOrder) {
    state = spyEngine.submitDescription(state, pid).state;
  }
  test('out-of-turn description is rejected', () => {
    let s2 = spyEngine.createInitialState({ playerIds: ['p1', 'p2', 'p3', 'p4'], spyCount: 1 });
    s2 = spyEngine.startDescribing(s2);
    assert.throws(() => spyEngine.submitDescription(s2, s2.turnOrder[1]), (err) => err.code === 'NOT_YOUR_TURN');
  });

  state = spyEngine.startVoting(state);
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    const target = pid === spyId ? ['p1', 'p2', 'p3', 'p4'].find((x) => x !== spyId && x !== pid) : spyId;
    state = spyEngine.submitVote(state, pid, target).state;
  }
  state = spyEngine.resolveVotes(state);
  test('civilians win when spy is voted out', () => assert.strictEqual(state.winner, 'civilians'));
  test('eliminated player role matches spy', () => {
    assert.strictEqual(state.eliminationHistory[0].eliminatedId, spyId);
    assert.strictEqual(state.eliminationHistory[0].role, 'spy');
  });

  test('redaction hides other players words mid-round', () => {
    let s = spyEngine.createInitialState({ playerIds: ['a', 'b', 'c'], spyCount: 1 });
    s = spyEngine.startDescribing(s);
    const redacted = spyEngine.redactStateForPlayer(s, 'a');
    const otherPlayerIds = Object.keys(redacted.players).filter((id) => id !== 'a');
    for (const id of otherPlayerIds) {
      assert.strictEqual(redacted.players[id].word, undefined, `player ${id}'s word should be hidden from 'a'`);
    }
    assert.notStrictEqual(redacted.players['a'].word, undefined, "player 'a' should see their own word");
  });
}

console.log('\n--- Mafia Engine ---');
{
  let state = mafiaEngine.createInitialState({ playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] });
  const mafiaId = Object.values(state.players).find((p) => p.role === 'mafia').id;
  const doctorId = Object.values(state.players).find((p) => p.role === 'doctor').id;
  const detectiveId = Object.values(state.players).find((p) => p.role === 'detective').id;
  const villagerIds = Object.values(state.players).filter((p) => p.role === 'villager').map((p) => p.id);

  test('6 players yields exactly 1 mafia, 1 detective, 1 doctor, 3 villagers', () => {
    const roles = Object.values(state.players).map((p) => p.role);
    assert.strictEqual(roles.filter((r) => r === 'mafia').length, 1);
    assert.strictEqual(roles.filter((r) => r === 'detective').length, 1);
    assert.strictEqual(roles.filter((r) => r === 'doctor').length, 1);
    assert.strictEqual(roles.filter((r) => r === 'villager').length, 3);
  });

  state = mafiaEngine.startNight(state);
  const target = villagerIds[0];
  state = mafiaEngine.submitMafiaVote(state, mafiaId, target);
  state = mafiaEngine.submitDoctorProtect(state, doctorId, villagerIds[1]);
  state = mafiaEngine.submitDetectiveCheck(state, detectiveId, mafiaId);
  state = mafiaEngine.resolveNight(state);

  test('unprotected target is killed', () => assert.strictEqual(state.lastNightResult.killedId, target));
  test('detective correctly identifies mafia', () => assert.strictEqual(state.detectiveResults[detectiveId][0].isMafia, true));

  state = mafiaEngine.startDayVoting(state);
  for (const pid of mafiaEngine.alivePlayers(state).map((p) => p.id)) {
    state = mafiaEngine.submitDayVote(state, pid, mafiaId).state;
  }
  state = mafiaEngine.resolveDayVote(state);
  test('villagers win once the only mafia is eliminated', () => assert.strictEqual(state.winner, 'villagers'));
}

{
  let state = mafiaEngine.createInitialState({ playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] });
  const mafiaId = Object.values(state.players).find((p) => p.role === 'mafia').id;
  const doctorId = Object.values(state.players).find((p) => p.role === 'doctor').id;
  const villagerIds = Object.values(state.players).filter((p) => p.role === 'villager').map((p) => p.id);

  state = mafiaEngine.startNight(state);
  const target = villagerIds[0];
  state = mafiaEngine.submitMafiaVote(state, mafiaId, target);
  state = mafiaEngine.submitDoctorProtect(state, doctorId, target);
  state = mafiaEngine.resolveNight(state);

  test('doctor protecting the exact target prevents the kill', () => {
    assert.strictEqual(state.lastNightResult.killedId, null);
    assert.strictEqual(state.lastNightResult.wasProtected, true);
  });
}

console.log('\n--- Draw & Guess Engine ---');
{
  let state = drawGuessEngine.createInitialState({ playerIds: ['p1', 'p2', 'p3'], roundsPerPlayer: 1 });
  state = drawGuessEngine.startNextRound(state);
  const drawerId = state.drawOrder[state.currentDrawerIndex];
  const word = state.wordOptions[0];
  state = drawGuessEngine.selectWord(state, drawerId, word);

  test('drawer cannot guess their own word', () => {
    assert.throws(() => drawGuessEngine.submitGuess(state, drawerId, word), (err) => err.code === 'DRAWER_CANNOT_GUESS');
  });

  const guessers = ['p1', 'p2', 'p3'].filter((p) => p !== drawerId);
  let r = drawGuessEngine.submitGuess(state, guessers[0], 'definitely wrong');
  test('wrong guess scores nothing', () => assert.strictEqual(r.correct, false));
  state = r.state;

  r = drawGuessEngine.submitGuess(state, guessers[0], `  ${word.toUpperCase()}  `);
  test('guess is case- and whitespace-insensitive', () => assert.strictEqual(r.correct, true));
  test('first correct guesser gets 100 points', () => assert.strictEqual(r.pointsAwarded, 100));
  state = r.state;

  r = drawGuessEngine.submitGuess(state, guessers[1], word);
  test('second correct guesser gets fewer points (80)', () => assert.strictEqual(r.pointsAwarded, 80));
  test('round completes once all non-drawers have guessed', () => assert.strictEqual(r.roundComplete, true));
  state = r.state;

  test('drawer earned bonus points for each correct guesser', () => assert.strictEqual(state.players[drawerId].score, 20));

  test('word is hidden from non-drawer during drawing phase', () => {
    let s2 = drawGuessEngine.createInitialState({ playerIds: ['a', 'b'], roundsPerPlayer: 1 });
    s2 = drawGuessEngine.startNextRound(s2);
    const d = s2.drawOrder[s2.currentDrawerIndex];
    s2 = drawGuessEngine.selectWord(s2, d, s2.wordOptions[0]);
    const nonDrawerId = ['a', 'b'].find((x) => x !== d);
    const redacted = drawGuessEngine.redactStateForPlayer(s2, nonDrawerId);
    assert.strictEqual(redacted.currentWord, undefined);
    assert.strictEqual(typeof redacted.wordLength, 'number');
  });
}

console.log(`\n✅ All ${passed} game engine assertions passed`);
