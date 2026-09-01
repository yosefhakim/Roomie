'use strict';

const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../db/pool');
const economyService = require('./economyService');
const { EconomyError } = economyService;

// Platform keeps a cut of every gift; the rest goes to the receiver as coins.
// A real production system would likely make this configurable per-gift or
// per-event via the admin dashboard economy controls; a flat rate is a
// reasonable, clearly-labeled starting point.
const RECEIVER_SHARE_RATIO = 0.7;

async function listCatalog() {
  const { rows } = await query(
    'SELECT * FROM gift_catalog WHERE is_active = TRUE ORDER BY sort_order ASC'
  );
  return rows;
}

async function getGiftBySlug(slug) {
  const { rows } = await query('SELECT * FROM gift_catalog WHERE slug = $1 AND is_active = TRUE', [slug]);
  return rows[0] || null;
}

/**
 * Sends a gift: debits the sender's coins, credits the receiver their share,
 * and records the gift_send event - all within a single transaction so a
 * failure at any step rolls back everything (no coins vanish, no gift is
 * recorded without payment, no partial credit).
 */
async function sendGift({ senderId, receiverId, giftSlug, roomId }) {
  if (senderId === receiverId) {
    throw new EconomyError('INVALID_TRANSFER', 'Cannot gift yourself');
  }

  const gift = await getGiftBySlug(giftSlug);
  if (!gift) {
    throw new EconomyError('GIFT_NOT_FOUND', `No active gift with slug ${giftSlug}`);
  }

  const receiverShare = Math.floor(Number(gift.price_coins) * RECEIVER_SHARE_RATIO);
  const sendId = uuidv4();

  return withTransaction(async (client) => {
    await economyService.applyLedgerEntry({
      userId: senderId,
      currency: 'coins',
      delta: -Number(gift.price_coins),
      reason: 'gift_sent',
      referenceType: 'gift',
      referenceId: sendId,
      metadata: { giftSlug, receiverId, roomId },
      client,
    });

    if (receiverShare > 0) {
      await economyService.applyLedgerEntry({
        userId: receiverId,
        currency: 'coins',
        delta: receiverShare,
        reason: 'gift_received',
        referenceType: 'gift',
        referenceId: sendId,
        metadata: { giftSlug, senderId, roomId },
        client,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO gift_sends (id, gift_id, sender_id, receiver_id, room_id, price_coins, receiver_share_coins)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [sendId, gift.id, senderId, receiverId, roomId || null, gift.price_coins, receiverShare]
    );

    return { giftSend: rows[0], gift };
  });
}

async function getRecentGiftsInRoom(roomId, { limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT gs.*, gc.slug, gc.display_name, gc.animation_key,
            sender.username AS sender_username, sender.display_name AS sender_display_name,
            receiver.username AS receiver_username, receiver.display_name AS receiver_display_name
     FROM gift_sends gs
     JOIN gift_catalog gc ON gc.id = gs.gift_id
     JOIN users sender ON sender.id = gs.sender_id
     JOIN users receiver ON receiver.id = gs.receiver_id
     WHERE gs.room_id = $1
     ORDER BY gs.created_at DESC
     LIMIT $2`,
    [roomId, limit]
  );
  return rows;
}

module.exports = { listCatalog, getGiftBySlug, sendGift, getRecentGiftsInRoom, RECEIVER_SHARE_RATIO };
