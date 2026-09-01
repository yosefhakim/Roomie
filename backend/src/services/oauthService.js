'use strict';

const { OAuth2Client } = require('google-auth-library');
const { jwtVerify, createRemoteJWKSet } = require('jose');
const env = require('../config/env');
const { AuthError } = require('./tokenService');
const logger = require('../config/logger').child({ module: 'oauthService' });

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

/**
 * Verifies a Google ID token (as obtained by the client from Google Sign-In)
 * and returns normalized profile info. Verifies signature, audience, issuer,
 * and expiry - google-auth-library handles fetching/caching Google's public
 * keys internally.
 */
async function verifyGoogleIdToken(idToken) {
  if (!googleClient) {
    throw new AuthError('OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured on this server');
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload.email_verified) {
      throw new AuthError('EMAIL_NOT_VERIFIED', 'Google account email is not verified');
    }
    return {
      provider: 'google',
      providerSub: payload.sub,
      email: payload.email,
      displayName: payload.name || payload.email.split('@')[0],
      avatarUrl: payload.picture || null,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    logger.warn({ err: err.message }, 'Google ID token verification failed');
    throw new AuthError('INVALID_OAUTH_TOKEN', 'Google ID token verification failed');
  }
}

// Apple's JWKS endpoint for verifying "Sign in with Apple" identity tokens.
// createRemoteJWKSet caches keys and handles rotation automatically.
const appleJWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Verifies an Apple identity token (JWT) sent from the client after
 * "Sign in with Apple". Unlike Google, Apple does not provide a
 * verification SDK - we verify the JWT signature against Apple's published
 * JWKS directly.
 */
async function verifyAppleIdToken(identityToken) {
  if (!env.APPLE_CLIENT_ID) {
    throw new AuthError('OAUTH_NOT_CONFIGURED', 'Apple OAuth is not configured on this server');
  }
  try {
    const { payload } = await jwtVerify(identityToken, appleJWKS, {
      issuer: 'https://appleid.apple.com',
      audience: env.APPLE_CLIENT_ID,
    });

    return {
      provider: 'apple',
      providerSub: payload.sub,
      email: payload.email || null,
      // Apple does not include a display name in the identity token; the
      // client must pass the name it collected from the native Apple
      // sign-in sheet on first authorization (Apple only provides it once).
      displayName: null,
      avatarUrl: null,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'Apple ID token verification failed');
    throw new AuthError('INVALID_OAUTH_TOKEN', 'Apple ID token verification failed');
  }
}

module.exports = { verifyGoogleIdToken, verifyAppleIdToken };
