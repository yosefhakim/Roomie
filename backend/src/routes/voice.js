'use strict';

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/httpAuth');
const voiceService = require('../services/voiceService');
const { validate } = require('../utils/schemas');
const logger = require('../config/logger').child({ module: 'voiceRoutes' });

const router = express.Router();
router.use(requireAuth);

const tokenRequestPayload = z.object({ roomId: z.string().uuid() });

router.post('/token', async (req, res) => {
  try {
    const payload = validate(tokenRequestPayload, req.body);
    const result = await voiceService.generateRoomVoiceToken({ roomId: payload.roomId, userId: req.user.id });
    res.json(result);
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') return res.status(400).json({ error: err.code, details: err.details });
    if (err.code === 'AGORA_NOT_CONFIGURED') return res.status(501).json({ error: err.code, message: err.message });
    if (err.code === 'ROOM_NOT_FOUND') return res.status(404).json({ error: err.code, message: err.message });
    if (err.code === 'NOT_A_MEMBER') return res.status(403).json({ error: err.code, message: err.message });
    logger.error({ err }, 'Failed to generate voice token');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
