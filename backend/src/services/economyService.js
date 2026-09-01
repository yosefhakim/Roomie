'use strict';

const { withTransaction, query } = require('../db/pool');
const logger = require('../config/logger').child({ module: 'economyService' });

class EconomyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EconomyError';
    this.code = code;
  }
}

/**
 * Every balance mutation in the entire system funnels through
 * `applyLedgerEntry`. This is deliberate: it is the ONLY function allowed
 * to write to `wallets.coins` / `wallets.diamonds`, and it always writes a
 * matching `ledger_entries` row in the same transaction, so the wallet
 * balance is always a reconstructable sum of the ledger (source of truth),
 * never a value that can silently drift from its history.
 *
 * Concurrency: uses `SELECT ... FOR UPDATE` to lock the wallet row before
 * computing the new balance, preventing lost updates when two operations
 * hit the same wallet concurrently (e.g. two gifts arriving at once).
 *
 * Idempotency: if `idempotencyKey` is provided and a ledger entry with that
 * key already exists, this is a no-op that returns the existing entry
 * rather than double-applying - critical for safely retrying Stripe
 * webhook deliveries.
 */
async function applyLedgerEntry({
  userId,
  currency,
  delta,
  reason,
  referenceType = null,
  referenceId = null,
  idempotencyKey = null,
  metadata = {},
  client: externalClient = null,
}) {
  if (!['coins', 'diamonds'].includes(currency)) {
    throw new EconomyError('INVALID_CURRENCY', `Unknown currency: ${currency}`);
  }
  if (!Number.isInteger(delta) || delta === 0) {
    throw new EconomyError('INVALID_DELTA', 'delta must be a nonzero integer');
  }

  const run = async (client) => {
    if (idempotencyKey) {
      const existing = await client.query('SELECT * FROM ledger_entries WHERE idempotency_key = $1', [idempotencyKey]);
      if (existing.rows[0]) {
        logger.info({ idempotencyKey, userId }, 'Ledger entry idempotency hit - skipping duplicate application');
        return { entry: existing.rows[0], duplicate: true };
      }
    }

    await client.query(
      `INSERT INTO wallets (user_id, coins, diamonds) VALUES ($1, 0, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    const wallet = walletRes.rows[0];
    if (!wallet) throw new EconomyError('WALLET_NOT_FOUND', 'Wallet could not be created or locked');

    const currentBalance = currency === 'coins' ? wallet.coins : wallet.diamonds;
    const newBalance = Number(currentBalance) + delta;

    if (newBalance < 0) {
      throw new EconomyError('INSUFFICIENT_BALANCE', `Insufficient ${currency} balance: has ${currentBalance}, needs ${-delta}`);
    }

    const column = currency === 'coins' ? 'coins' : 'diamonds';
    const lifetimeUpdate =
      currency === 'coins' && delta > 0
        ? ', lifetime_coins_earned = lifetime_coins_earned + $3'
        : currency === 'diamonds' && delta > 0
        ? ', lifetime_diamonds_purchased = lifetime_diamonds_purchased + $3'
        : '';

    const updateParams = lifetimeUpdate ? [newBalance, userId, delta] : [newBalance, userId];
    await client.query(
      `UPDATE wallets SET ${column} = $1${lifetimeUpdate} WHERE user_id = $2`,
      updateParams
    );

    const entryRes = await client.query(
      `INSERT INTO ledger_entries
         (user_id, currency, delta, balance_after, reason, reference_type, reference_id, idempotency_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, currency, delta, newBalance, reason, referenceType, referenceId, idempotencyKey, JSON.stringify(metadata)]
    );

    return { entry: entryRes.rows[0], duplicate: false };
  };

  if (externalClient) {
    return run(externalClient);
  }
  return withTransaction(run);
}

/**
 * Atomically transfers currency from one user to another (debit + credit in
 * a single transaction) - used for gift sending. If the credit somehow
 * fails after the debit succeeds, the whole transaction rolls back,
 * restoring the sender's balance - this is the "rollback mechanism"
 * guarantee: partial transfers are impossible by construction, not by
 * compensating logic bolted on afterward.
 */
async function transfer({ fromUserId, toUserId, currency, amount, reason, referenceType, referenceId, metadata = {} }) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new EconomyError('INVALID_AMOUNT', 'amount must be a positive integer');
  }
  if (fromUserId === toUserId) {
    throw new EconomyError('INVALID_TRANSFER', 'Cannot transfer to self');
  }

  return withTransaction(async (client) => {
    const debit = await applyLedgerEntry({
      userId: fromUserId,
      currency,
      delta: -amount,
      reason: `${reason}_sent`,
      referenceType,
      referenceId,
      metadata: { ...metadata, counterparty: toUserId },
      client,
    });

    const credit = await applyLedgerEntry({
      userId: toUserId,
      currency,
      delta: amount,
      reason: `${reason}_received`,
      referenceType,
      referenceId,
      metadata: { ...metadata, counterparty: fromUserId },
      client,
    });

    return { debit: debit.entry, credit: credit.entry };
  });
}

async function getWallet(userId) {
  const { rows } = await query(
    `INSERT INTO wallets (user_id, coins, diamonds) VALUES ($1, 0, 0)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId]
  );
  return rows[0];
}

async function getLedgerHistory(userId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT * FROM ledger_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

/**
 * Reconciliation helper: recomputes a user's balance purely from the ledger
 * and compares it to the materialized `wallets` row. In a correctly
 * functioning system these always match (every write to `wallets` happens
 * in the same transaction as the ledger insert) - this exists as an
 * operational integrity check, e.g. to run periodically or after suspected
 * data issues, not as part of normal request handling.
 */
async function verifyBalanceIntegrity(userId) {
  const { rows: sums } = await query(
    `SELECT currency, COALESCE(SUM(delta), 0)::bigint AS total
     FROM ledger_entries WHERE user_id = $1 GROUP BY currency`,
    [userId]
  );
  const wallet = await getWallet(userId);

  const coinsSum = Number(sums.find((s) => s.currency === 'coins')?.total || 0);
  const diamondsSum = Number(sums.find((s) => s.currency === 'diamonds')?.total || 0);

  const coinsMatch = coinsSum === Number(wallet.coins);
  const diamondsMatch = diamondsSum === Number(wallet.diamonds);

  if (!coinsMatch || !diamondsMatch) {
    logger.error(
      { userId, coinsSum, walletCoins: wallet.coins, diamondsSum, walletDiamonds: wallet.diamonds },
      'BALANCE INTEGRITY MISMATCH DETECTED'
    );
  }

  return {
    ok: coinsMatch && diamondsMatch,
    coinsMatch,
    diamondsMatch,
    ledgerCoins: coinsSum,
    walletCoins: Number(wallet.coins),
    ledgerDiamonds: diamondsSum,
    walletDiamonds: Number(wallet.diamonds),
  };
}

module.exports = {
  EconomyError,
  applyLedgerEntry,
  transfer,
  getWallet,
  getLedgerHistory,
  verifyBalanceIntegrity,
};
