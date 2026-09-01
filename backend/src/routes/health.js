'use strict';

const express = require('express');
const { redisClient } = require('../config/redis');
const { pool } = require('../db/pool');

const router = express.Router();

router.get('/healthz', async (req, res) => {
  const health = { status: 'ok', uptime: process.uptime(), timestamp: Date.now() };

  try {
    const pong = await redisClient.ping();
    health.redis = pong === 'PONG' ? 'ok' : 'degraded';
  } catch (err) {
    health.redis = 'down';
    health.status = 'degraded';
  }

  try {
    await pool.query('SELECT 1');
    health.postgres = 'ok';
  } catch (err) {
    health.postgres = 'down';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

router.get('/readyz', async (req, res) => {
  try {
    await Promise.all([redisClient.ping(), pool.query('SELECT 1')]);
    res.status(200).json({ ready: true });
  } catch (err) {
    res.status(503).json({ ready: false });
  }
});

module.exports = router;
