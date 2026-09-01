'use strict';

const { query, withTransaction } = require('../db/pool');
const economyService = require('./economyService');
const { EconomyError } = economyService;

// Mission definitions live in code (not the DB) since they're small in
// number and ship with app releases. Only per-user progress is persisted.
// `periodType: 'daily'` missions reset every day (period_key = today's date);
// add 'weekly'/'lifetime' periodType values here later if needed - the
// progress table's period_key column already supports arbitrary period
// granularity without a schema change.
const MISSION_DEFINITIONS = {
  join_3_rooms: { target: 3, rewardCoins: 30, periodType: 'daily', label: 'Join 3 rooms' },
  send_1_gift: { target: 1, rewardCoins: 20, periodType: 'daily', label: 'Send a gift' },
  chat_5_minutes: { target: 5, rewardCoins: 25, periodType: 'daily', label: 'Spend 5 minutes in voice chat' },
};

function todayPeriodKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Increments progress on a mission by `amount`. Safe to call from multiple
 * places (e.g. room:join handler calls this for join_3_rooms) - uses
 * upsert + row lock so concurrent increments for the same user/mission
 * don't lose updates. Does NOT auto-claim the reward; claiming is a
 * separate explicit step (claimMissionReward) so the client can show a
 * "claim" button/animation rather than coins silently appearing.
 */
async function incrementMissionProgress(userId, missionKey, amount = 1) {
  const def = MISSION_DEFINITIONS[missionKey];
  if (!def) throw new EconomyError('UNKNOWN_MISSION', `No mission definition for ${missionKey}`);

  const periodKey = todayPeriodKey();

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO mission_progress (user_id, mission_key, period_key, progress, target)
       VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (user_id, mission_key, period_key) DO NOTHING`,
      [userId, missionKey, periodKey, def.target]
    );

    const { rows } = await client.query(
      `SELECT * FROM mission_progress WHERE user_id = $1 AND mission_key = $2 AND period_key = $3 FOR UPDATE`,
      [userId, missionKey, periodKey]
    );
    const current = rows[0];
    if (current.completed_at) {
      return current; // already complete, no further progress needed
    }

    const newProgress = Math.min(current.progress + amount, current.target);
    const nowCompleted = newProgress >= current.target;

    const { rows: updated } = await client.query(
      `UPDATE mission_progress
       SET progress = $1, completed_at = CASE WHEN $2 THEN now() ELSE completed_at END
       WHERE user_id = $3 AND mission_key = $4 AND period_key = $5
       RETURNING *`,
      [newProgress, nowCompleted, userId, missionKey, periodKey]
    );
    return updated[0];
  });
}

async function claimMissionReward(userId, missionKey) {
  const def = MISSION_DEFINITIONS[missionKey];
  if (!def) throw new EconomyError('UNKNOWN_MISSION', `No mission definition for ${missionKey}`);
  const periodKey = todayPeriodKey();

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM mission_progress WHERE user_id = $1 AND mission_key = $2 AND period_key = $3 FOR UPDATE`,
      [userId, missionKey, periodKey]
    );
    const progress = rows[0];
    if (!progress || !progress.completed_at) {
      throw new EconomyError('MISSION_NOT_COMPLETE', 'Mission is not yet complete');
    }
    if (progress.reward_claimed) {
      throw new EconomyError('REWARD_ALREADY_CLAIMED', 'Reward already claimed for this mission');
    }

    await client.query(
      `UPDATE mission_progress SET reward_claimed = TRUE
       WHERE user_id = $1 AND mission_key = $2 AND period_key = $3`,
      [userId, missionKey, periodKey]
    );

    const { entry } = await economyService.applyLedgerEntry({
      userId,
      currency: 'coins',
      delta: def.rewardCoins,
      reason: 'mission_reward',
      referenceType: 'mission',
      metadata: { missionKey, periodKey },
      client,
    });

    return { missionKey, coinsAwarded: def.rewardCoins, ledgerEntry: entry };
  });
}

async function getTodayMissions(userId) {
  const periodKey = todayPeriodKey();
  const { rows } = await query(
    `SELECT * FROM mission_progress WHERE user_id = $1 AND period_key = $2`,
    [userId, periodKey]
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.mission_key, r]));

  return Object.entries(MISSION_DEFINITIONS).map(([key, def]) => {
    const progress = byKey[key];
    return {
      key,
      label: def.label,
      target: def.target,
      rewardCoins: def.rewardCoins,
      progress: progress?.progress || 0,
      completed: Boolean(progress?.completed_at),
      rewardClaimed: Boolean(progress?.reward_claimed),
    };
  });
}

module.exports = {
  MISSION_DEFINITIONS,
  incrementMissionProgress,
  claimMissionReward,
  getTodayMissions,
};
