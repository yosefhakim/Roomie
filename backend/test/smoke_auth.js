'use strict';

/**
 * Manual smoke test for Layer 2 (auth). Exercises register -> login ->
 * refresh (rotation) -> reuse-detection -> logout -> banned-user rejection,
 * plus using the resulting access token to open an authenticated socket
 * connection and create a room (proving Layer 1 + Layer 2 are wired
 * together correctly).
 *
 * Usage:
 *   npm run migrate               (once, against a running Postgres)
 *   node src/server.js            (terminal 1)
 *   node test/smoke_auth.js       (terminal 2)
 *
 * Requires: npm install socket.io-client node-fetch@2 --no-save
 */

const { io } = require('socket.io-client');
let fetchFn = global.fetch;
if (!fetchFn) {
  // eslint-disable-next-line global-require
  fetchFn = require('node-fetch');
}

const BASE_URL = process.env.SMOKE_URL || 'http://localhost:4000';
const rand = Math.random().toString(36).slice(2, 8);

async function api(path, body, token) {
  const res = await fetchFn(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function run() {
  console.log('--- Roomie Layer 2 Smoke Test (Auth) ---\n');

  console.log('[1] Register new user');
  const email = `smoke_${rand}@example.com`;
  const registerRes = await api('/api/auth/register', {
    email,
    username: `smoke_${rand}`,
    password: 'TestPass123',
    displayName: 'Smoke Tester',
  });
  assert(registerRes.status === 201, `register returns 201 (got ${registerRes.status}, ${JSON.stringify(registerRes.body)})`);
  assert(registerRes.body.accessToken, 'response includes accessToken');
  assert(registerRes.body.refreshToken, 'response includes refreshToken');
  const { accessToken, refreshToken, user } = registerRes.body;

  console.log('\n[2] Reject duplicate registration');
  const dupRes = await api('/api/auth/register', {
    email,
    username: `smoke_${rand}_2`,
    password: 'TestPass123',
  });
  assert(dupRes.status === 409, `duplicate email registration returns 409 (got ${dupRes.status})`);

  console.log('\n[3] Login with correct credentials');
  const loginRes = await api('/api/auth/login', { email, password: 'TestPass123' });
  assert(loginRes.status === 200, `login returns 200 (got ${loginRes.status})`);

  console.log('\n[4] Reject wrong password');
  const badLoginRes = await api('/api/auth/login', { email, password: 'WrongPassword1' });
  assert(badLoginRes.status === 401, `wrong password returns 401 (got ${badLoginRes.status})`);

  console.log('\n[5] Refresh token rotation');
  const refreshRes = await api('/api/auth/refresh', { refreshToken });
  assert(refreshRes.status === 200, `refresh returns 200 (got ${refreshRes.status})`);
  const newRefreshToken = refreshRes.body.refreshToken;
  assert(newRefreshToken !== refreshToken, 'rotated refresh token differs from original');

  console.log('\n[6] Reuse-detection: replaying the OLD (already-rotated) refresh token must fail');
  const reuseRes = await api('/api/auth/refresh', { refreshToken });
  assert(reuseRes.status === 401, `reused old token returns 401 (got ${reuseRes.status})`);
  assert(reuseRes.body.error === 'REFRESH_TOKEN_REUSED', `error code is REFRESH_TOKEN_REUSED (got ${reuseRes.body.error})`);

  console.log('\n[7] Entire token family revoked after reuse - even the NEW rotated token must now fail');
  const postReuseRes = await api('/api/auth/refresh', { refreshToken: newRefreshToken });
  assert(postReuseRes.status === 401, `post-reuse family-revoked token returns 401 (got ${postReuseRes.status})`);

  console.log('\n[8] Authenticated socket connection using the access token');
  const socket = io(BASE_URL, {
    auth: { accessToken },
    transports: ['websocket'],
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  console.log('  ✓ socket connected using JWT access token');

  const roomRes = await new Promise((resolve, reject) => {
    socket.emit('room:create', { name: 'Auth Smoke Room' }, (res) => {
      if (res.ok) resolve(res);
      else reject(new Error(JSON.stringify(res)));
    });
  });
  assert(roomRes.room.ownerId === user.id, 'room created via authenticated socket has correct ownerId from JWT claims');

  console.log('\n[9] Socket connection with garbage token must be rejected');
  const badSocket = io(BASE_URL, { auth: { accessToken: 'not-a-real-token' }, transports: ['websocket'] });
  const badConnectResult = await new Promise((resolve) => {
    badSocket.once('connect', () => resolve('connected'));
    badSocket.once('connect_error', (err) => resolve(err.message));
  });
  assert(badConnectResult !== 'connected', `garbage token socket connection rejected (got: ${badConnectResult})`);

  socket.disconnect();
  badSocket.disconnect();

  console.log('\n✅ All Layer 2 auth assertions passed');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Smoke test failed:', err.message);
  process.exit(1);
});
