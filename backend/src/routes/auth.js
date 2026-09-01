'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../services/authService');
const { AuthError } = require('../services/tokenService');
const {
  validate,
  registerPayload,
  loginPayload,
  googleLoginPayload,
  appleLoginPayload,
  refreshPayload,
} = require('../utils/schemas');
const logger = require('../config/logger').child({ module: 'authRoutes' });

const router = express.Router();

// Stricter limiter for auth endpoints specifically - these are the highest
// value targets for credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many auth attempts, please try again later' },
});
router.use(authLimiter);

function clientMeta(req) {
  return { userAgent: req.headers['user-agent'] || null, ipAddress: req.ip };
}

function handleAuthError(err, res) {
  if (err instanceof AuthError) {
    const statusMap = {
      EMAIL_TAKEN: 409,
      USERNAME_TAKEN: 409,
      INVALID_CREDENTIALS: 401,
      ACCOUNT_BANNED: 403,
      INVALID_REFRESH_TOKEN: 401,
      REFRESH_TOKEN_REVOKED: 401,
      REFRESH_TOKEN_EXPIRED: 401,
      REFRESH_TOKEN_REUSED: 401,
      USER_NOT_FOUND: 401,
      OAUTH_NOT_CONFIGURED: 501,
      INVALID_OAUTH_TOKEN: 401,
      EMAIL_NOT_VERIFIED: 401,
    };
    const status = statusMap[err.code] || 400;
    return res.status(status).json({ error: err.code, message: err.message });
  }
  if (err.code === 'VALIDATION_ERROR') {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid request', details: err.details });
  }
  logger.error({ err }, 'Unexpected auth error');
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
}

router.post('/register', async (req, res) => {
  try {
    const payload = validate(registerPayload, req.body);
    const result = await authService.register({ ...payload, ...clientMeta(req) });
    res.status(201).json(result);
  } catch (err) {
    handleAuthError(err, res);
  }
});

router.post('/login', async (req, res) => {
  try {
    const payload = validate(loginPayload, req.body);
    const result = await authService.login({ ...payload, ...clientMeta(req) });
    res.status(200).json(result);
  } catch (err) {
    handleAuthError(err, res);
  }
});

router.post('/oauth/google', async (req, res) => {
  try {
    const payload = validate(googleLoginPayload, req.body);
    const result = await authService.loginWithGoogle({ ...payload, ...clientMeta(req) });
    res.status(200).json(result);
  } catch (err) {
    handleAuthError(err, res);
  }
});

router.post('/oauth/apple', async (req, res) => {
  try {
    const payload = validate(appleLoginPayload, req.body);
    const result = await authService.loginWithApple({ ...payload, ...clientMeta(req) });
    res.status(200).json(result);
  } catch (err) {
    handleAuthError(err, res);
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const payload = validate(refreshPayload, req.body);
    const result = await authService.refresh({ ...payload, ...clientMeta(req) });
    res.status(200).json(result);
  } catch (err) {
    handleAuthError(err, res);
  }
});

router.post('/logout', async (req, res) => {
  try {
    const payload = validate(refreshPayload, req.body);
    await authService.logout(payload);
    res.status(204).send();
  } catch (err) {
    handleAuthError(err, res);
  }
});

module.exports = router;
