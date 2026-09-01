'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const { query } = require('../db/pool');
const logger = require('../config/logger').child({ module: 'tokenService' });

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      displayName: user.display_name,
      isAdmin: user.is_admin,
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      issuer: env.JWT_ISSUER,
    }
  );
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: env.JWT_ISSUER });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new AuthError('TOKEN_EXPIRED', 'Access token expired');
    throw new AuthError('INVALID_TOKEN', 'Invalid access token');
  }
}

/**
 * Issues a new refresh token and persists its hash. `familyId` groups all
 * tokens descended from a single original login - rotating a token creates
 * a new row in the same family. If a token is ever presented twice (reuse
 * of an already-rotated token, indicating possible theft), the entire
 * family is revoked - see `rotateRefreshToken`.
 */
async function issueRefreshToken({ userId, familyId = null, replaces = null, userAgent = null, ipAddress = null }) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashToken(raw);
  const family = familyId || uuidv4();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000);

  const { rows } = await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, tokenHash, family, expiresAt, userAgent, ipAddress]
  );

  if (replaces) {
    await query('UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2', [rows[0].id, replaces]);
  }

  return { raw, familyId: family, expiresAt };
}

/**
 * Validates a presented refresh token and, if valid, rotates it: the
 * presented token is marked used (replaced_by set) and a fresh one is
 * issued in the same family. If the presented token was already rotated
 * previously (i.e. someone is replaying an old token - classic sign of
 * token theft), the ENTIRE family is revoked immediately, forcing
 * re-authentication.
 */
async function rotateRefreshToken({ rawToken, userAgent = null, ipAddress = null }) {
  const tokenHash = hashToken(rawToken);
  const { rows } = await query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  const stored = rows[0];

  if (!stored) {
    throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token not recognized');
  }

  if (stored.revoked_at) {
    throw new AuthError('REFRESH_TOKEN_REVOKED', 'Refresh token has been revoked');
  }

  if (new Date(stored.expires_at) < new Date()) {
    throw new AuthError('REFRESH_TOKEN_EXPIRED', 'Refresh token expired');
  }

  if (stored.replaced_by) {
    // This token was already rotated once before - someone is replaying an
    // old token. Revoke the whole family as a precaution.
    logger.warn({ userId: stored.user_id, familyId: stored.family_id }, 'Refresh token reuse detected - revoking family');
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
      stored.family_id,
    ]);
    throw new AuthError('REFRESH_TOKEN_REUSED', 'Token reuse detected; all sessions revoked for safety');
  }

  const next = await issueRefreshToken({
    userId: stored.user_id,
    familyId: stored.family_id,
    replaces: stored.id,
    userAgent,
    ipAddress,
  });

  return { userId: stored.user_id, ...next };
}

async function revokeAllForUser(userId) {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

async function revokeToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);
}

module.exports = {
  AuthError,
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllForUser,
  revokeToken,
};
