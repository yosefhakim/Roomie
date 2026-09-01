'use strict';

const express = require('express');
const roomService = require('../services/roomService');
const logger = require('../config/logger').child({ module: 'roomsRoute' });

const router = express.Router();

// GET /api/rooms - public lobby listing. Password-protected rooms are
// still listed (so users can discover them) but their passwordHash is
// stripped by getRoomState's caller convention elsewhere; here we strip
// explicitly since this is a raw REST path, not going through the socket
// sanitizer.
router.get('/rooms', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const rooms = await roomService.listActiveRooms({ limit });
    const sanitized = rooms
      .filter((r) => r.visibility !== 'private')
      .map(({ passwordHash, ...rest }) => rest);
    res.json({ rooms: sanitized, count: sanitized.length });
  } catch (err) {
    logger.error({ err }, 'Failed to list rooms');
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list rooms' });
  }
});

router.get('/rooms/:roomId', async (req, res) => {
  try {
    const room = await roomService.getRoomState(req.params.roomId);
    if (!room) {
      return res.status(404).json({ error: 'ROOM_NOT_FOUND' });
    }
    const { passwordHash, ...sanitized } = room;
    res.json({ room: sanitized });
  } catch (err) {
    logger.error({ err, roomId: req.params.roomId }, 'Failed to fetch room');
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch room' });
  }
});

module.exports = router;
