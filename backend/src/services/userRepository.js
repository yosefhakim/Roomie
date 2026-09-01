'use strict';

const { query, withTransaction } = require('../db/pool');

async function findByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findByUsername(username) {
  const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByOAuthSub(provider, providerSub) {
  const { rows } = await query(
    `SELECT u.* FROM users u
     JOIN oauth_identities oi ON oi.user_id = u.id
     WHERE oi.provider = $1 AND oi.provider_sub = $2`,
    [provider, providerSub]
  );
  return rows[0] || null;
}

async function createLocalUser({ email, username, displayName, passwordHash }) {
  const { rows } = await query(
    `INSERT INTO users (email, username, display_name, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, username, displayName, passwordHash]
  );
  return rows[0];
}

/**
 * Creates a user + oauth_identity row atomically. Used for first-time OAuth
 * sign-in. If a user with this provider_sub already exists (race between
 * two concurrent requests, e.g. a double-tapped sign-in button), the unique
 * constraint on (provider, provider_sub) will cause the insert to fail;
 * caller should catch and re-fetch via findByOAuthSub.
 */
async function createOAuthUser({ email, username, displayName, avatarUrl, provider, providerSub }) {
  return withTransaction(async (client) => {
    const userResult = await client.query(
      `INSERT INTO users (email, username, display_name, avatar_url, email_verified)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING *`,
      [email, username, displayName, avatarUrl || null]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO oauth_identities (user_id, provider, provider_sub, email)
       VALUES ($1, $2, $3, $4)`,
      [user.id, provider, providerSub, email]
    );

    return user;
  });
}

async function linkOAuthIdentity({ userId, provider, providerSub, email }) {
  await query(
    `INSERT INTO oauth_identities (user_id, provider, provider_sub, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, provider_sub) DO NOTHING`,
    [userId, provider, providerSub, email]
  );
}

async function updateLastLogin(userId) {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  // Upsert today's activity row for DAU/MAU analytics. ON CONFLICT DO
  // NOTHING keeps this idempotent for a user logging in multiple times in
  // the same day.
  await query(
    `INSERT INTO user_activity_days (user_id, activity_date)
     VALUES ($1, CURRENT_DATE)
     ON CONFLICT DO NOTHING`,
    [userId]
  );
}

async function setBanStatus({ userId, banned, reason }) {
  const { rows } = await query(
    `UPDATE users
     SET is_banned = $2, ban_reason = $3, banned_at = CASE WHEN $2 THEN now() ELSE NULL END
     WHERE id = $1
     RETURNING *`,
    [userId, banned, reason || null]
  );
  return rows[0] || null;
}

async function listUsers({ limit = 50, offset = 0, search = null }) {
  if (search) {
    const { rows } = await query(
      `SELECT id, email, username, display_name, is_banned, is_admin, created_at, last_login_at
       FROM users
       WHERE username ILIKE $1 OR email ILIKE $1 OR display_name ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [`%${search}%`, limit, offset]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT id, email, username, display_name, is_banned, is_admin, created_at, last_login_at
     FROM users
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function countUsers() {
  const { rows } = await query('SELECT COUNT(*)::int AS count FROM users');
  return rows[0].count;
}

module.exports = {
  findByEmail,
  findByUsername,
  findById,
  findByOAuthSub,
  createLocalUser,
  createOAuthUser,
  linkOAuthIdentity,
  updateLastLogin,
  setBanStatus,
  listUsers,
  countUsers,
};
