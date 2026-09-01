'use strict';

/**
 * Manual smoke test for Layer 4 (Economy). Registers two fresh users,
 * grants coins via the admin ledger path (requires manually promoting the
 * first user to admin - see instructions printed below), sends a gift,
 * claims the daily reward, and verifies ledger integrity throughout.
 *
 * Usage:
 *   npm run migrate
 *   node src/server.js               (terminal 1)
 *   node test/smoke_economy.js       (terminal 2)
 */

let fetchFn = global.fetch;
if (!fetchFn) fetchFn = require('node-fetch');

const BASE_URL = process.env.SMOKE_URL || 'http://localhost:4000';
const rand = Math.random().toString(36).slice(2, 8);

async function api(method, path, body, token) {
  const res = await fetchFn(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function registerUser(suffix) {
  const email = `smoke_econ_${rand}_${suffix}@example.com`;
  const res = await api('POST', '/api/auth/register', {
    email,
    username: `smoke_econ_${rand}_${suffix}`,
    password: 'TestPass123',
    displayName: `Econ Smoke ${suffix}`,
  });
  if (res.status !== 201) throw new Error(`Failed to register user ${suffix}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function run() {
  console.log('--- Roomie Layer 4 Smoke Test (Economy) ---\n');

  console.log('[1] Register sender and receiver');
  const sender = await registerUser('sender');
  const receiver = await registerUser('receiver');
  console.log(`  sender=${sender.user.username} receiver=${receiver.user.username}`);

  console.log('\n[2] Fetch initial wallets (should both be 0 coins, 0 diamonds)');
  const senderWallet0 = await api('GET', '/api/economy/wallet', null, sender.accessToken);
  assert(senderWallet0.body.wallet.coins === '0' || senderWallet0.body.wallet.coins === 0, 'sender starts with 0 coins');

  console.log('\n[3] Claim daily reward for sender');
  const claim1 = await api('POST', '/api/economy/daily-reward/claim', null, sender.accessToken);
  assert(claim1.status === 201, `first daily claim succeeds (got ${claim1.status})`);
  assert(claim1.body.streakDay === 1, `first claim is streak day 1 (got ${claim1.body.streakDay}`);
  assert(claim1.body.coinsAwarded === 50, `day 1 reward is 50 coins (got ${claim1.body.coinsAwarded})`);

  console.log('\n[4] Reject duplicate same-day claim');
  const claim2 = await api('POST', '/api/economy/daily-reward/claim', null, sender.accessToken);
  assert(claim2.status === 400, `duplicate claim rejected (got ${claim2.status})`);
  assert(claim2.body.error === 'ALREADY_CLAIMED', `error is ALREADY_CLAIMED (got ${claim2.body.error})`);

  console.log('\n[5] Verify wallet reflects the daily reward');
  const senderWallet1 = await api('GET', '/api/economy/wallet', null, sender.accessToken);
  assert(Number(senderWallet1.body.wallet.coins) === 50, `sender now has 50 coins (got ${senderWallet1.body.wallet.coins})`);

  console.log('\n[6] Attempt to send a gift sender cannot afford (crown = 500 coins, sender has 50)');
  const catalogRes = await api('GET', '/api/economy/gifts/catalog', null, sender.accessToken);
  const crown = catalogRes.body.catalog.find((g) => g.slug === 'crown');
  assert(crown && Number(crown.price_coins) === 500, 'crown gift exists in seeded catalog at 500 coins');

  const failedGift = await api(
    'POST',
    '/api/economy/gifts/send',
    { receiverId: receiver.user.id, giftSlug: 'crown' },
    sender.accessToken
  );
  assert(failedGift.status === 402, `insufficient balance returns 402 (got ${failedGift.status})`);

  console.log('\n[7] Send an affordable gift (rose = 10 coins)');
  const giftRes = await api(
    'POST',
    '/api/economy/gifts/send',
    { receiverId: receiver.user.id, giftSlug: 'rose' },
    sender.accessToken
  );
  assert(giftRes.status === 201, `affordable gift send succeeds (got ${giftRes.status}, ${JSON.stringify(giftRes.body)})`);

  console.log('\n[8] Verify sender debited and receiver credited correctly (70% share)');
  const senderWallet2 = await api('GET', '/api/economy/wallet', null, sender.accessToken);
  const receiverWallet = await api('GET', '/api/economy/wallet', null, receiver.accessToken);
  assert(Number(senderWallet2.body.wallet.coins) === 40, `sender balance is 50 - 10 = 40 (got ${senderWallet2.body.wallet.coins})`);
  assert(Number(receiverWallet.body.wallet.coins) === 7, `receiver gets floor(10*0.7)=7 coins (got ${receiverWallet.body.wallet.coins})`);

  console.log('\n[9] Verify ledger history shows both entries for sender');
  const history = await api('GET', '/api/economy/wallet/history', null, sender.accessToken);
  assert(history.body.entries.length === 2, `sender ledger has 2 entries: daily reward + gift sent (got ${history.body.entries.length})`);

  console.log('\n[10] Verify send_1_gift mission auto-completed for sender');
  const missions = await api('GET', '/api/economy/missions/today', null, sender.accessToken);
  const giftMission = missions.body.missions.find((m) => m.key === 'send_1_gift');
  assert(giftMission.completed === true, 'send_1_gift mission marked completed after sending a gift');

  console.log('\n[11] Claim the completed mission reward');
  const missionClaim = await api('POST', '/api/economy/missions/claim', { missionKey: 'send_1_gift' }, sender.accessToken);
  assert(missionClaim.status === 201, `mission claim succeeds (got ${missionClaim.status})`);
  assert(missionClaim.body.coinsAwarded === 20, `send_1_gift rewards 20 coins (got ${missionClaim.body.coinsAwarded})`);

  console.log('\n[12] Reject double-claiming the same mission');
  const missionClaim2 = await api('POST', '/api/economy/missions/claim', { missionKey: 'send_1_gift' }, sender.accessToken);
  assert(missionClaim2.status === 400, `double claim rejected (got ${missionClaim2.status})`);

  console.log('\n[13] Final balance check: 40 (post-gift) + 20 (mission) = 60');
  const finalWallet = await api('GET', '/api/economy/wallet', null, sender.accessToken);
  assert(Number(finalWallet.body.wallet.coins) === 60, `final sender balance is 60 (got ${finalWallet.body.wallet.coins})`);

  console.log('\n✅ All Layer 4 economy assertions passed');
  console.log('\nNote: Stripe purchase flow was NOT exercised by this script - it requires');
  console.log('real STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET and either the Stripe CLI');
  console.log('(`stripe listen --forward-to localhost:4000/api/webhooks/stripe`) or a');
  console.log('live test-mode webhook to trigger fulfillment. Verify that path manually.');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Smoke test failed:', err.message);
  process.exit(1);
});
