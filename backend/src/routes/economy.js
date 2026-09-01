'use strict';

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/httpAuth');
const economyService = require('../services/economyService');
const giftService = require('../services/giftService');
const dailyRewardService = require('../services/dailyRewardService');
const missionService = require('../services/missionService');
const stripeService = require('../services/stripeService');
const { validate } = require('../utils/schemas');
const logger = require('../config/logger').child({ module: 'economyRoutes' });

const router = express.Router();
router.use(requireAuth);

function handleEconomyError(err, res) {
  if (err.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: err.code, message: err.message });
  if (err.code === 'VALIDATION_ERROR') return res.status(400).json({ error: err.code, details: err.details });
  const clientErrorCodes = [
    'INVALID_CURRENCY',
    'INVALID_DELTA',
    'INVALID_AMOUNT',
    'INVALID_TRANSFER',
    'GIFT_NOT_FOUND',
    'ALREADY_CLAIMED',
    'UNKNOWN_MISSION',
    'MISSION_NOT_COMPLETE',
    'REWARD_ALREADY_CLAIMED',
    'UNKNOWN_PACKAGE',
    'STRIPE_NOT_CONFIGURED',
  ];
  if (clientErrorCodes.includes(err.code)) {
    return res.status(400).json({ error: err.code, message: err.message });
  }
  logger.error({ err }, 'Unexpected economy error');
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

router.get('/wallet', async (req, res) => {
  try {
    const wallet = await economyService.getWallet(req.user.id);
    res.json({ wallet });
  } catch (err) {
    handleEconomyError(err, res);
  }
});

router.get('/wallet/history', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const entries = await economyService.getLedgerHistory(req.user.id, { limit, offset });
    res.json({ entries });
  } catch (err) {
    handleEconomyError(err, res);
  }
});

// ---------------------------------------------------------------------------
// Gifts
// ---------------------------------------------------------------------------

router.get('/gifts/catalog', async (req, res) => {
  try {
    const catalog = await giftService.listCatalog();
    res.json({ catalog });
  } catch (err) {
    handleEconomyError(err, res);
  }
});

const sendGiftPayload = z.object({
  receiverId: z.string().uuid(),
  giftSlug: z.string().min(1).max(40),
  roomId: z.string().uuid().optional(),
});

router.post('/gifts/send', async (req, res) => {
  try {
    const payload = validate(sendGiftPayload, req.body);
    const result = await giftService.sendGift({
      senderId: req.user.id,
      receiverId: payload.receiverId,
      giftSlug: payload.giftSlug,
      roomId: payload.roomId,
    });

    // Broadcast the gift animation event to the room in real time, if this
    // gift was sent in the context of a room. This is what triggers the
    // "gift explosion" animation client-side (Layer 7).
    if (payload.roomId) {
      const io = req.app.get('io');
      if (io) {
        io.to(payload.roomId).emit('gift:received', {
          giftSlug: payload.giftSlug,
          animationKey: result.gift.animation_key,
          senderId: req.user.id,
          senderDisplayName: req.user.displayName,
          receiverId: payload.receiverId,
          roomId: payload.roomId,
        });
      }
    }

    // Fire-and-forget mission progress - never blocks or fails the gift
    // response itself.
    missionService.incrementMissionProgress(req.user.id, 'send_1_gift', 1).catch((err) => {
      logger.warn({ err, userId: req.user.id }, 'Failed to increment send_1_gift mission progress');
    });

    res.status(201).json({ giftSend: result.giftSend });
  } catch (err) {
    handleEconomyError(err, res);
  }
});

router.get('/gifts/room/:roomId', async (req, res) => {
  try {
    const gifts = await giftService.getRecentGiftsInRoom(req.params.roomId, { limit: 20 });
    res.json({ gifts });
  } catch (err) {
    handleEconomyError(err, res);
  }
});

// ---------------------------------------------------------------------------
// Daily rewards
// ---------------------------------------------------------------------------

router.get('/daily-reward/status', async (req, res) => {
  try {
    const status = await dailyRewardService.getDailyRewardStatus(req.user.id);
    res.json(status);
  } catch (err) {
    handleEconomyError(err, res);
  }
});

router.post('/daily-reward/claim', async (req, res) => {
  try {
    const result = await dailyRewardService.claimDailyReward(req.user.id);
    res.status(201).json(result);
  } catch (err) {
    handleEconomyError(err, res);
  }
});

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

router.get('/missions/today', async (req, res) => {
  try {
    const missions = await missionService.getTodayMissions(req.user.id);
    res.json({ missions });
  } catch (err) {
    handleEconomyError(err, res);
  }
});

const claimMissionPayload = z.object({ missionKey: z.string().min(1).max(50) });

router.post('/missions/claim', async (req, res) => {
  try {
    const payload = validate(claimMissionPayload, req.body);
    const result = await missionService.claimMissionReward(req.user.id, payload.missionKey);
    res.status(201).json(result);
  } catch (err) {
    handleEconomyError(err, res);
  }
});

// ---------------------------------------------------------------------------
// Stripe purchases
// ---------------------------------------------------------------------------

router.get('/purchases/packages', (req, res) => {
  res.json({ packages: stripeService.DIAMOND_PACKAGES });
});

const createPurchasePayload = z.object({
  packageKey: z.enum(['starter', 'popular', 'value', 'mega']),
});

router.post('/purchases/create-intent', async (req, res) => {
  try {
    const payload = validate(createPurchasePayload, req.body);
    const result = await stripeService.createPurchaseIntent({ userId: req.user.id, packageKey: payload.packageKey });
    res.status(201).json(result);
  } catch (err) {
    handleEconomyError(err, res);
  }
});

router.get('/purchases/history', async (req, res) => {
  try {
    const orders = await stripeService.getOrderHistory(req.user.id);
    res.json({ orders });
  } catch (err) {
    handleEconomyError(err, res);
  }
});

module.exports = router;
