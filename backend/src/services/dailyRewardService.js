'use strict';

const { query, withTransaction } = require('../db/pool');
const economyService = require('./economyService');
const { EconomyError } = economyService;

// Reward escalates through a 7-day cycle, then repeats. Day 7 has a bonus
// to encourage full-week completion.
const STREAK_REWARDS = [50, 75, 100, 125, 150, 200, 500];

function computeStreakDay(previousStreakDay, wasYesterday) {
  if (!wasYesterday) return 1;
  return (previousStreakDay % STREAK_REWARDS.length) + 1;
}

/**
 * Claims today's daily reward for a user, if not already claimed. Streak
 * continues only if yesterday was also claimed; otherwise resets to day 1.
 * The whole read-check-write sequence runs in a transaction with the claim
 * insert as the atomicity boundary - the UNIQUE (user_id, claim_date)
 * primary key on daily_reward_claims is what actually prevents a
 * double-claim race, not just the transaction.
 */
async function claimDailyReward(userId) {
  return withTransaction(async (client) => {
    const todayRes = await client.query(
      `SELECT 1 FROM daily_reward_claims WHERE user_id = $1 AND claim_date = CURRENT_DATE`
    , [userId]);
    if (todayRes.rows.length > 0) {
      throw new EconomyError('ALREADY_CLAIMED', 'Daily reward already claimed today');
    }

    const yesterdayRes = await client.query(
      `SELECT streak_day FROM daily_reward_claims WHERE user_id = $1 AND claim_date = CURRENT_DATE - INTERVAL '1 day'`,
      [userId]
    );
    const wasYesterday = yesterdayRes.rows.length > 0;
    const previousStreakDay = wasYesterday ? yesterdayRes.rows[0].streak_day : 0;
    const streakDay = computeStreakDay(previousStreakDay, wasYesterday);
    const coinsAwarded = STREAK_REWARDS[streakDay - 1];

    await client.query(
      `INSERT INTO daily_reward_claims (user_id, claim_date, streak_day, coins_awarded)
       VALUES ($1, CURRENT_DATE, $2, $3)`,
      [userId, streakDay, coinsAwarded]
    );

    const { entry } = await economyService.applyLedgerEntry({
      userId,
      currency: 'coins',
      delta: coinsAwarded,
      reason: 'daily_reward',
      referenceType: 'daily_reward',
      metadata: { streakDay },
      client,
    });

    return { streakDay, coinsAwarded, ledgerEntry: entry };
  });
}

async function getDailyRewardStatus(userId) {
  const { rows } = await query(
    `SELECT claim_date, streak_day, coins_awarded FROM daily_reward_claims
     WHERE user_id = $1 ORDER BY claim_date DESC LIMIT 1`,
    [userId]
  );
  const last = rows[0];
  const claimedToday = last && new Date(last.claim_date).toDateString() === new Date().toDateString();

  const nextStreakDay = last
    ? computeStreakDay(
        last.streak_day,
        isYesterday(last.claim_date)
      )
    : 1;

  return {
    claimedToday,
    lastClaim: last || null,
    nextReward: STREAK_REWARDS[(claimedToday ? last.streak_day - 1 : nextStreakDay - 1)],
    schedule: STREAK_REWARDS,
  };
}

function isYesterday(dateVal) {
  const d = new Date(dateVal);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return d.toDateString() === yesterday.toDateString();
}

module.exports = { claimDailyReward, getDailyRewardStatus, STREAK_REWARDS };
