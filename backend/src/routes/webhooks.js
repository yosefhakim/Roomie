'use strict';

const express = require('express');
const stripeService = require('../services/stripeService');
const logger = require('../config/logger').child({ module: 'stripeWebhook' });

const router = express.Router();

// IMPORTANT: this route must receive the RAW request body, not JSON-parsed,
// because Stripe's signature verification (constructEvent) computes an HMAC
// over the exact bytes Stripe sent. If express.json() has already parsed
// and re-serialized the body, the signature check will fail even for
// legitimate requests. See app.js for how this router is mounted BEFORE
// the global express.json() middleware to guarantee raw bytes here.
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'MISSING_SIGNATURE' });
  }

  try {
    const result = await stripeService.handleWebhook({ rawBody: req.body, signature });
    res.status(200).json(result);
  } catch (err) {
    if (err.code === 'INVALID_SIGNATURE') {
      logger.warn('Rejected webhook with invalid signature');
      return res.status(400).json({ error: err.code });
    }
    logger.error({ err }, 'Webhook processing failed');
    res.status(500).json({ error: 'WEBHOOK_PROCESSING_FAILED' });
  }
});

module.exports = router;
