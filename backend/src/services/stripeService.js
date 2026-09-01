'use strict';

const Stripe = require('stripe');
const { query, withTransaction } = require('../db/pool');
const economyService = require('./economyService');
const env = require('../config/env');
const logger = require('../config/logger').child({ module: 'stripeService' });

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;

// Diamond packages available for purchase. Kept in code (not a DB table),
// mirroring the mission-definitions approach - small, versioned with app
// releases, changed rarely enough that a migration per price change is
// acceptable and safer than letting arbitrary prices be requested by clients.
const DIAMOND_PACKAGES = {
  starter: { diamonds: 100, amountCents: 99, label: '100 Diamonds' },
  popular: { diamonds: 550, amountCents: 499, label: '550 Diamonds' },
  value: { diamonds: 1200, amountCents: 999, label: '1200 Diamonds' },
  mega: { diamonds: 6500, amountCents: 4999, label: '6500 Diamonds' },
};

function assertConfigured() {
  if (!stripe) {
    const err = new Error('Stripe is not configured on this server (STRIPE_SECRET_KEY missing)');
    err.code = 'STRIPE_NOT_CONFIGURED';
    throw err;
  }
}

/**
 * Creates a Stripe PaymentIntent for a diamond package and records a
 * pending `stripe_orders` row. The client confirms this PaymentIntent using
 * Stripe's client-side SDK (Stripe Elements / mobile SDK) - this server
 * never touches raw card details, per Stripe's PCI-scope-reducing design.
 */
async function createPurchaseIntent({ userId, packageKey }) {
  assertConfigured();
  const pkg = DIAMOND_PACKAGES[packageKey];
  if (!pkg) {
    const err = new Error(`Unknown diamond package: ${packageKey}`);
    err.code = 'UNKNOWN_PACKAGE';
    throw err;
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: pkg.amountCents,
    currency: 'usd',
    metadata: { userId, packageKey, diamonds: String(pkg.diamonds) },
  });

  await query(
    `INSERT INTO stripe_orders (user_id, stripe_payment_intent_id, diamonds_purchased, amount_cents, currency, status)
     VALUES ($1, $2, $3, $4, 'usd', 'pending')`,
    [userId, paymentIntent.id, pkg.diamonds, pkg.amountCents]
  );

  return { clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id, package: pkg };
}

/**
 * Verifies a Stripe webhook signature and processes the event. This is the
 * ONLY place diamonds are actually credited for a purchase - the client
 * confirming a PaymentIntent client-side is never trusted on its own,
 * since that confirmation is not cryptographically verifiable server-side
 * the way a signed webhook payload is.
 *
 * Idempotent by construction: `applyLedgerEntry`'s idempotencyKey (set to
 * the Stripe event id) means a retried webhook delivery for the same event
 * will not double-credit diamonds.
 */
async function handleWebhook({ rawBody, signature }) {
  assertConfigured();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    const err = new Error('STRIPE_WEBHOOK_SECRET not configured - cannot verify webhook signatures');
    err.code = 'STRIPE_WEBHOOK_NOT_CONFIGURED';
    throw err;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err: err.message }, 'Stripe webhook signature verification failed');
    const wrapped = new Error('Invalid webhook signature');
    wrapped.code = 'INVALID_SIGNATURE';
    throw wrapped;
  }

  logger.info({ eventType: event.type, eventId: event.id }, 'Stripe webhook received');

  switch (event.type) {
    case 'payment_intent.succeeded':
      await fulfillPurchase(event);
      break;
    case 'payment_intent.payment_failed':
      await markOrderFailed(event);
      break;
    default:
      logger.info({ eventType: event.type }, 'Unhandled Stripe event type - ignoring');
  }

  return { received: true };
}

async function fulfillPurchase(event) {
  const paymentIntent = event.data.object;
  const { userId, diamonds } = paymentIntent.metadata;

  if (!userId || !diamonds) {
    logger.error({ paymentIntentId: paymentIntent.id }, 'Stripe payment_intent missing required metadata - cannot fulfill');
    return;
  }

  await withTransaction(async (client) => {
    const orderRes = await client.query(
      `SELECT * FROM stripe_orders WHERE stripe_payment_intent_id = $1 FOR UPDATE`,
      [paymentIntent.id]
    );
    const order = orderRes.rows[0];
    if (!order) {
      logger.error({ paymentIntentId: paymentIntent.id }, 'No matching stripe_orders row for succeeded payment intent');
      return;
    }
    if (order.status === 'succeeded') {
      logger.info({ paymentIntentId: paymentIntent.id }, 'Order already fulfilled - skipping (idempotent webhook retry)');
      return;
    }

    await client.query(`UPDATE stripe_orders SET status = 'succeeded' WHERE id = $1`, [order.id]);

    await economyService.applyLedgerEntry({
      userId: order.user_id,
      currency: 'diamonds',
      delta: Number(order.diamonds_purchased),
      reason: 'purchase',
      referenceType: 'stripe_order',
      referenceId: order.id,
      idempotencyKey: `stripe_${event.id}`,
      metadata: { paymentIntentId: paymentIntent.id, amountCents: order.amount_cents },
      client,
    });
  });

  logger.info({ paymentIntentId: paymentIntent.id, userId }, 'Diamond purchase fulfilled');
}

async function markOrderFailed(event) {
  const paymentIntent = event.data.object;
  await query(`UPDATE stripe_orders SET status = 'failed' WHERE stripe_payment_intent_id = $1`, [paymentIntent.id]);
  logger.info({ paymentIntentId: paymentIntent.id }, 'Order marked failed');
}

async function getOrderHistory(userId, { limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT * FROM stripe_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

module.exports = { DIAMOND_PACKAGES, createPurchaseIntent, handleWebhook, getOrderHistory };
