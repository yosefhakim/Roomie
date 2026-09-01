'use strict';

/**
 * Manual smoke test for Layer 1. Not a formal test suite (that lands with
 * CI in a later layer) - this is a runnable script that exercises the full
 * room lifecycle end-to-end against a running server instance, so you can
 * verify the layer works before moving on.
 *
 * Usage:
 *   node src/server.js            (terminal 1)
 *   node test/smoke.js            (terminal 2)
 *
 * Requires: npm install socket.io-client --no-save  (dev-only, not in package.json
 * dependencies since it's only needed to run this manual script)
 */

const { io } = require('socket.io-client');

const URL = process.env.SMOKE_URL || 'http://localhost:4000';

function connect(userId, displayName) {
  return io(URL, {
    auth: { token: 'dev-token', userId, displayName },
    transports: ['websocket'],
  });
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function ackPromise(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (res) => {
      if (res && res.ok === false) reject(new Error(JSON.stringify(res)));
      else resolve(res);
    });
  });
}

async function run() {
  console.log('--- Roomie Layer 1 Smoke Test ---');

  const owner = connect('user-owner-1', 'Alice');
  await once(owner, 'connect');
  console.log('[owner] connected:', owner.id);

  const createRes = await ackPromise(owner, 'room:create', {
    name: 'Alice Hangout',
    visibility: 'public',
  });
  console.log('[owner] room created:', createRes.room.id, 'members:', createRes.room.memberCount);
  const roomId = createRes.room.id;

  const guest = connect('user-guest-1', 'Bob');
  await once(guest, 'connect');
  console.log('[guest] connected:', guest.id);

  const ownerSawJoin = once(owner, 'room:memberJoined');
  const joinRes = await ackPromise(guest, 'room:join', { roomId });
  console.log('[guest] joined room, memberCount:', joinRes.room.memberCount);

  const joinEvent = await ownerSawJoin;
  console.log('[owner] observed memberJoined event for:', joinEvent.userId);

  console.log('[guest] raising hand...');
  const handRes = await ackPromise(guest, 'room:raiseHand', { roomId, raised: true });
  console.log('[guest] hand raised:', handRes.member.handRaised);

  console.log('[owner] promoting guest to speaker...');
  const roleRes = await ackPromise(owner, 'room:setRole', {
    roomId,
    targetUserId: 'user-guest-1',
    newRole: 'speaker',
  });
  console.log('[owner] guest new role:', roleRes.member.role);

  console.log('[guest] simulating disconnect + fast reconnect...');
  const guestSocketId = guest.id;
  guest.disconnect();
  await new Promise((r) => setTimeout(r, 500));

  const guestReconnect = connect('user-guest-1', 'Bob');
  await once(guestReconnect, 'connect');
  const rejoinRes = await ackPromise(guestReconnect, 'room:join', { roomId });
  console.log('[guest] reconnected + rejoined, memberCount:', rejoinRes.room.memberCount, '(should still be 2, not 3)');

  console.log('[guest] leaving room...');
  const ownerSawLeave = once(owner, 'room:memberLeft');
  await ackPromise(guestReconnect, 'room:leave', { roomId });
  const leaveEvent = await ownerSawLeave;
  console.log('[owner] observed memberLeft for:', leaveEvent.userId);

  console.log('[owner] leaving room (last member, should destroy room)...');
  const ownerLeaveRes = await ackPromise(owner, 'room:leave', { roomId });
  console.log('[owner] room deleted:', ownerLeaveRes.roomDeleted);

  console.log('\n✅ Smoke test completed successfully');
  owner.disconnect();
  guestReconnect.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Smoke test failed:', err);
  process.exit(1);
});
