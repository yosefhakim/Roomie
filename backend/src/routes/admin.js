'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/httpAuth');
const userRepo = require('../services/userRepository');
const adminRepo = require('../services/adminRepository');
const economyService = require('../services/economyService');
const roomService = require('../services/roomService');
const tokenService = require('../services/tokenService');
const { validate } = require('../utils/schemas');
const { z } = require('zod');
const logger = require('../config/logger').child({ module: 'adminRoutes' });

const router = express.Router();

// Every route below requires a valid, non-banned, admin-flagged user.
router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

router.get('/analytics/overview', async (req, res) => {
  try {
    const [userCounts, dau, mau, activeRooms] = await Promise.all([
      adminRepo.getUserCounts(),
      adminRepo.getTodayActiveUsers(),
      adminRepo.getMonthlyActiveUsers(),
      roomService.listActiveRooms({ limit: 1000 }),
    ]);
    res.json({
      users: userCounts,
      dau,
      mau,
      activeRoomCount: activeRooms.length,
      totalConnectedMembers: activeRooms.reduce((sum, r) => sum + r.memberCount, 0),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load analytics overview');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.get('/analytics/dau', async (req, res) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const series = await adminRepo.getDailyActiveUsers(days);
    res.json({ series });
  } catch (err) {
    logger.error({ err }, 'Failed to load DAU series');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.get('/analytics/signups', async (req, res) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const series = await adminRepo.getNewUserSignups(days);
    res.json({ series });
  } catch (err) {
    logger.error({ err }, 'Failed to load signup series');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

router.get('/users', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = req.query.search ? String(req.query.search).slice(0, 100) : null;
    const [users, total] = await Promise.all([
      userRepo.listUsers({ limit, offset, search }),
      adminRepo.getUserCounts(),
    ]);
    res.json({ users, total: total.total });
  } catch (err) {
    logger.error({ err }, 'Failed to list users');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.get('/users/:userId', async (req, res) => {
  try {
    const user = await userRepo.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const wallet = await economyService.getWallet(user.id);
    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, wallet });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch user detail');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

const banPayload = z.object({ reason: z.string().trim().min(1).max(500) });

router.post('/users/:userId/ban', async (req, res) => {
  try {
    const payload = validate(banPayload, req.body);
    const target = await userRepo.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    if (target.is_admin) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot ban another admin' });
    }

    const updated = await userRepo.setBanStatus({ userId: target.id, banned: true, reason: payload.reason });
    await tokenService.revokeAllForUser(target.id); // force logout everywhere
    await adminRepo.logAdminAction({
      adminUserId: req.user.id,
      action: 'ban_user',
      targetUserId: target.id,
      metadata: { reason: payload.reason },
    });

    logger.info({ adminId: req.user.id, targetId: target.id }, 'User banned');
    res.json({ user: updated });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') return res.status(400).json({ error: err.code, details: err.details });
    logger.error({ err }, 'Failed to ban user');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.post('/users/:userId/unban', async (req, res) => {
  try {
    const target = await userRepo.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const updated = await userRepo.setBanStatus({ userId: target.id, banned: false });
    await adminRepo.logAdminAction({ adminUserId: req.user.id, action: 'unban_user', targetUserId: target.id });

    logger.info({ adminId: req.user.id, targetId: target.id }, 'User unbanned');
    res.json({ user: updated });
  } catch (err) {
    logger.error({ err }, 'Failed to unban user');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

const coinAdjustPayload = z.object({
  amount: z.number().int().refine((n) => n !== 0, 'amount must be nonzero'),
  reason: z.string().trim().min(1).max(500),
});

router.post('/users/:userId/coins', async (req, res) => {
  try {
    const payload = validate(coinAdjustPayload, req.body);
    const target = await userRepo.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const { entry } = await economyService.applyLedgerEntry({
      userId: target.id,
      currency: 'coins',
      delta: payload.amount,
      reason: 'admin_grant',
      referenceType: 'admin_action',
      referenceId: req.user.id,
      metadata: { reason: payload.reason, adminId: req.user.id },
    });
    const wallet = await economyService.getWallet(target.id);

    await adminRepo.logAdminAction({
      adminUserId: req.user.id,
      action: payload.amount > 0 ? 'grant_coins' : 'revoke_coins',
      targetUserId: target.id,
      metadata: { amount: payload.amount, reason: payload.reason, newBalance: wallet.coins },
    });

    logger.info({ adminId: req.user.id, targetId: target.id, amount: payload.amount }, 'Coin balance adjusted');
    res.json({ wallet, ledgerEntry: entry });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') return res.status(400).json({ error: err.code, details: err.details });
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: 'INSUFFICIENT_BALANCE', message: 'Adjustment would drive balance negative' });
    }
    logger.error({ err }, 'Failed to adjust coins');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// Room moderation (reads/writes live Redis room state from Layer 1)
// ---------------------------------------------------------------------------

router.get('/rooms', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rooms = await roomService.listActiveRooms({ limit });
    res.json({ rooms, count: rooms.length });
  } catch (err) {
    logger.error({ err }, 'Failed to list rooms for moderation');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.post('/rooms/:roomId/close', async (req, res) => {
  try {
    const room = await roomService.getRoomState(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });

    // Notify connected clients BEFORE tearing down Redis state, so the
    // broadcast still has a valid room to target. `req.app.get('io')` is
    // set in server.js once the socket server is initialized - see the
    // comment there for why this indirection exists instead of importing
    // the socket module directly (would create a circular require between
    // app.js and sockets/index.js).
    const io = req.app.get('io');
    if (io) {
      io.to(req.params.roomId).emit('room:forceClosed', {
        roomId: req.params.roomId,
        reason: 'Closed by administrator',
      });
    }

    await roomService.destroyRoom(req.params.roomId);
    await adminRepo.logAdminAction({
      adminUserId: req.user.id,
      action: 'force_close_room',
      metadata: { roomId: req.params.roomId, roomName: room.name },
    });

    logger.info({ adminId: req.user.id, roomId: req.params.roomId }, 'Room force-closed by admin');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Failed to close room');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

router.get('/audit-log', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const entries = await adminRepo.getAuditLog({ limit, offset });
    res.json({ entries });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch audit log');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
