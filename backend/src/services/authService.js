'use strict';

const { v4: uuidv4 } = require('uuid');
const userRepo = require('./userRepository');
const { hashPassword, verifyPassword } = require('./passwordService');
const tokenService = require('./tokenService');
const { verifyGoogleIdToken, verifyAppleIdToken } = require('./oauthService');
const { AuthError } = tokenService;

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    isAdmin: user.is_admin,
    createdAt: user.created_at,
  };
}

async function issueSessionTokens(user, { userAgent, ipAddress } = {}) {
  const accessToken = tokenService.signAccessToken(user);
  const refresh = await tokenService.issueRefreshToken({ userId: user.id, userAgent, ipAddress });
  await userRepo.updateLastLogin(user.id);
  return {
    accessToken,
    refreshToken: refresh.raw,
    refreshExpiresAt: refresh.expiresAt,
    user: toPublicUser(user),
  };
}

async function register({ email, username, password, displayName, userAgent, ipAddress }) {
  const existingEmail = await userRepo.findByEmail(email);
  if (existingEmail) throw new AuthError('EMAIL_TAKEN', 'An account with this email already exists');

  const existingUsername = await userRepo.findByUsername(username);
  if (existingUsername) throw new AuthError('USERNAME_TAKEN', 'This username is already taken');

  const passwordHash = await hashPassword(password);
  const user = await userRepo.createLocalUser({
    email,
    username,
    displayName: displayName || username,
    passwordHash,
  });

  return issueSessionTokens(user, { userAgent, ipAddress });
}

async function login({ email, password, userAgent, ipAddress }) {
  const user = await userRepo.findByEmail(email);
  // Constant-shape response whether the user exists or not, to avoid
  // leaking account existence via timing/response differences beyond what
  // argon2's inherent verify cost already normalizes.
  if (!user || !user.password_hash) {
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.is_banned) {
    throw new AuthError('ACCOUNT_BANNED', 'This account has been banned');
  }

  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
  }

  return issueSessionTokens(user, { userAgent, ipAddress });
}

async function loginWithGoogle({ idToken, userAgent, ipAddress }) {
  const profile = await verifyGoogleIdToken(idToken);
  return loginOrCreateFromOAuth(profile, { userAgent, ipAddress });
}

async function loginWithApple({ identityToken, fullName, userAgent, ipAddress }) {
  const profile = await verifyAppleIdToken(identityToken);
  if (fullName) profile.displayName = fullName;
  return loginOrCreateFromOAuth(profile, { userAgent, ipAddress });
}

async function loginOrCreateFromOAuth(profile, { userAgent, ipAddress }) {
  let user = await userRepo.findByOAuthSub(profile.provider, profile.providerSub);

  if (!user && profile.email) {
    // If an account with this email already exists (e.g. registered via
    // password originally), link the OAuth identity to it rather than
    // creating a duplicate account.
    const existing = await userRepo.findByEmail(profile.email);
    if (existing) {
      await userRepo.linkOAuthIdentity({
        userId: existing.id,
        provider: profile.provider,
        providerSub: profile.providerSub,
        email: profile.email,
      });
      user = existing;
    }
  }

  if (!user) {
    const usernameBase = (profile.displayName || profile.email || 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
    const username = `${usernameBase}_${uuidv4().slice(0, 6)}`;
    try {
      user = await userRepo.createOAuthUser({
        email: profile.email,
        username,
        displayName: profile.displayName || username,
        avatarUrl: profile.avatarUrl,
        provider: profile.provider,
        providerSub: profile.providerSub,
      });
    } catch (err) {
      // Unique constraint race: another concurrent request created the
      // same oauth identity first. Re-fetch instead of failing the login.
      if (err.code === '23505') {
        user = await userRepo.findByOAuthSub(profile.provider, profile.providerSub);
      } else {
        throw err;
      }
    }
  }

  if (user.is_banned) {
    throw new AuthError('ACCOUNT_BANNED', 'This account has been banned');
  }

  return issueSessionTokens(user, { userAgent, ipAddress });
}

async function refresh({ refreshToken, userAgent, ipAddress }) {
  const rotated = await tokenService.rotateRefreshToken({ rawToken: refreshToken, userAgent, ipAddress });
  const user = await userRepo.findById(rotated.userId);
  if (!user) throw new AuthError('USER_NOT_FOUND', 'User for this token no longer exists');
  if (user.is_banned) throw new AuthError('ACCOUNT_BANNED', 'This account has been banned');

  const accessToken = tokenService.signAccessToken(user);
  return {
    accessToken,
    refreshToken: rotated.raw,
    refreshExpiresAt: rotated.expiresAt,
    user: toPublicUser(user),
  };
}

async function logout({ refreshToken }) {
  await tokenService.revokeToken(refreshToken);
}

async function logoutAllSessions(userId) {
  await tokenService.revokeAllForUser(userId);
}

module.exports = {
  toPublicUser,
  register,
  login,
  loginWithGoogle,
  loginWithApple,
  refresh,
  logout,
  logoutAllSessions,
};
