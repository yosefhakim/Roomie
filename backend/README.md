# Roomie Backend — Layers 1-6 (Core Server, Auth, Admin API, Economy, Games, Voice)

Real-time room/lobby system: create/join/leave rooms, presence, roles
(owner/admin/speaker/listener), mute/hand-raise, kick, and reconnect-with-grace-period
handling. Horizontally scalable via the Socket.io Redis adapter.

## What's included in this layer

- Express HTTP server with health checks (`/healthz`, `/readyz`) and a REST
  lobby-browse endpoint (`GET /api/rooms`)
- Socket.io server with Redis adapter (multi-instance ready)
- Redis-backed room state, membership, and presence (`src/services/roomService.js`)
- Room lifecycle events: `room:create`, `room:join`, `room:leave`, `room:setRole`,
  `room:setMute`, `room:raiseHand`, `room:kick`
- Disconnect handling with a configurable reconnect grace period — a dropped
  connection doesn't instantly evict the user from the room
- Ownership transfer when the owner leaves; automatic room teardown when empty
- Zod validation on every socket payload
- Per-user, per-event Redis-backed rate limiting
- Structured logging (pino), graceful shutdown on SIGTERM/SIGINT

## Layer 2 additions: Authentication

- PostgreSQL schema for users, OAuth identities, and refresh tokens
  (`migrations/`), applied via a simple tracked migration runner
  (`npm run migrate`)
- Password auth: argon2id hashing (`src/services/passwordService.js`)
- JWT access tokens (short-lived, 15 min default) + rotating refresh tokens
  with **reuse detection**: presenting an already-rotated refresh token
  revokes the entire token family, forcing re-login (`src/services/tokenService.js`)
- OAuth sign-in: Google (via `google-auth-library`, verifies the ID token
  signature/audience/issuer) and Apple (via JWKS verification against
  Apple's published keys) — `src/services/oauthService.js`
- `src/middleware/socketAuth.js` **now performs real JWT verification** and
  a live ban-status check on every socket connection — this fully replaces
  the Layer 1 stub that trusted the client
- `src/middleware/httpAuth.js` — `requireAuth`/`requireAdmin` Express
  middleware for protecting REST routes (used by the admin dashboard in Layer 3)
- REST endpoints under `/api/auth`: `register`, `login`, `oauth/google`,
  `oauth/apple`, `refresh`, `logout` — with a stricter rate limiter (20
  req/15min) than general API traffic

### Socket auth contract change

Clients now connect with:

```js
io(url, { auth: { accessToken: "<JWT from login/register/refresh>" } })
```

The old `{ auth: { token, userId, displayName } }` shape from Layer 1 no
longer works — `userId`/`displayName` are now derived from the verified JWT
claims, never trusted from the client directly.

## Layer 3 additions: Admin API surface

- Migrations 002/003 add an admin audit log, DAU/MAU activity tracking, and
  (003) a placeholder wallet table later superseded by Layer 4
- `src/services/adminRepository.js` — analytics queries (DAU, MAU, signup
  series, user counts) and audit log read/write
- `src/routes/admin.js`, mounted at `/api/admin`, all behind
  `requireAuth` + `requireAdmin`: analytics overview/DAU/signups, user
  list/detail/ban/unban/coin-adjust, room list/force-close (broadcasts
  `room:forceClosed` to evict members live), audit log
- The React+Tailwind dashboard itself lives in `/admin-dashboard` (sibling
  directory, separate README)

## Layer 4 additions: Economy System

- Migration 004 replaces the Layer 3 placeholder `wallets` table with a
  real economy schema: `wallets` (coins + diamonds), an append-only
  `ledger_entries` table (source of truth for every balance), a seeded
  `gift_catalog`, `gift_sends`, `daily_reward_claims`, `mission_progress`,
  `stripe_orders`
- `src/services/economyService.js` — **the only code path allowed to write
  to wallet balances.** Every mutation goes through `applyLedgerEntry`,
  which row-locks the wallet (`SELECT ... FOR UPDATE`), writes the new
  balance and a matching ledger row in the same transaction, and supports
  an `idempotencyKey` so retried external events (Stripe webhooks) never
  double-apply. `transfer()` builds gift-sending on top of this as a single
  debit+credit transaction — a failure at any step rolls back the whole
  thing, so partial transfers are impossible by construction
- `src/services/giftService.js` — gift catalog + sending, platform keeps a
  30% cut (`RECEIVER_SHARE_RATIO`), broadcasts `gift:received` to the room
  via socket for client-side animation triggers
- `src/services/dailyRewardService.js` — 7-day escalating streak, one claim
  per calendar day enforced by a DB primary key, not just application logic
- `src/services/missionService.js` — counter-based daily missions
  (`join_3_rooms`, `send_1_gift`, `chat_5_minutes`), wired as fire-and-forget
  hooks into `room:join` and gift-send so a mission-tracking hiccup never
  blocks the primary action
- `src/services/stripeService.js` — creates PaymentIntents for diamond
  packages; **diamonds are only ever credited from a signature-verified
  webhook** (`/api/webhooks/stripe`), never from client-side purchase
  confirmation, since only the webhook payload is cryptographically
  verifiable server-side
- `src/routes/economy.js` (`/api/economy/*`) and `src/routes/webhooks.js`
  (`/api/webhooks/stripe`, deliberately mounted in `app.js` **before**
  `express.json()` — Stripe signature verification needs the raw
  unparsed body)
- Admin coin grant/revoke (Layer 3) now writes through this same ledger
  instead of the old placeholder table

## Layer 5 additions: Game Logic

Three server-authoritative games, sharing infrastructure but each with its
own pure state-machine module:

- `src/games/spy/spyEngine.js` — **Who's the Spy**: lobby → describing →
  voting → reveal, looping until spies are all eliminated (civilians win)
  or spies >= remaining civilians (spies win). Turn-order enforced
  server-side; word pairs from a curated pool (`wordPairs.js`)
- `src/games/mafia/mafiaEngine.js` — **Mafia/Werewolf**: lobby → night →
  day_discussion → day_voting → day_reveal, looping. Role count scales
  with lobby size (mafia/detective/doctor/villager). Night actions (mafia
  kill vote, detective check, doctor protect) all resolve together at
  night's end. Mafia players can see each other's identity; nobody else
  can, until game end
- `src/games/drawguess/drawGuessEngine.js` — **Draw & Guess**: lobby →
  word_selection → drawing → round_end, rotating the drawer. Server offers
  3 random word choices (never client-supplied, to prevent picking an easy
  custom word); scoring rewards faster correct guesses and gives the
  drawer a per-guesser bonus
- `src/services/gameSessionService.js` — shared Redis-backed session
  storage with **optimistic-concurrency (CAS) writes via a Lua script**:
  every state mutation checks a version counter hasn't changed since read,
  so two players acting at nearly the same instant (e.g. simultaneous
  votes) can't silently clobber each other's update
- `src/games/gameTimer.js` — server-authoritative phase timers (in-process,
  not persisted — see the "known limitation" note in that file). The
  timer's *expiry* is what actually triggers a phase transition, never a
  client message; clients only render a countdown against the
  server-provided `phaseEndsAt` timestamp
- `src/games/gameHandlers.js` — wires the pure engines to sockets: per-game
  event handlers, and critically, **per-player state redaction** on every
  broadcast (`game:state` is emitted individually to each connected socket
  with secrets hidden/shown according to that specific player's
  role — nobody can inspect network traffic to learn hidden roles/words)

### Design choice: pure engines, separate I/O layer

Every engine file (`spyEngine.js`, `mafiaEngine.js`, `drawGuessEngine.js`)
is pure functions: `(state, action) -> newState`, no Redis, no sockets, no
timers. This is what let these get **actually executed and verified**
during development (not just syntax-checked like every other layer) — see
`test/game_engines.test.js`, which runs in a couple seconds with zero
external dependencies (`node test/game_engines.test.js`, no Docker, no DB).
All 19 assertions in that file passed as part of building this layer.

### Canvas relay design

Draw & Guess canvas strokes are NOT part of the versioned game session —
they're relayed via a separate, unvalidated fan-out event
(`game:draw:stroke`) directly from the drawer's socket to the rest of the
room. Putting every mouse-move through the CAS-versioned session would
make it enormous and contend the lock constantly; strokes are ephemeral
broadcast data, not state that needs perfect reconnect fidelity.

## Layer 6 additions: Voice Chat (Agora)

- `src/services/voiceService.js` — Agora RTC token generation using the
  `agora-token` package. Maps Roomie's existing room roles
  (owner/admin/speaker → Agora PUBLISHER; listener → Agora SUBSCRIBER) so a
  listener cannot obtain a publish-capable token by tampering with the
  client — voice publish rights are enforced server-side at token
  issuance, not client-side. The Agora numeric `uid` is deterministically
  derived from the Roomie `userId` (hashed into Agora's required unsigned
  32-bit range) so the same user always maps to the same Agora uid
- `src/routes/voice.js` — `POST /api/voice/token` — issues a token only
  after confirming the requesting user is an actual member of the target
  room (checked against Layer 1's live Redis room state)
- `src/sockets/voiceHandlers.js` — `voice:activity` (client-side VAD relay:
  Agora's SDK detects speaking client-side via its volume indicator; this
  server only relays "user X is speaking, volume Y" to the room so
  everyone's UI can render the correct avatar's speaking ring/glow — the
  server does no audio analysis itself) and `voice:selfMuteToggle`
  (self-mute convenience wrapper around the existing Layer 1
  `room:setMute` path)
- `room:setRole` (Layer 1) now also emits `voice:roleChanged` directly to
  the affected user's socket, since Agora tokens bake in
  publish/subscribe capability at issuance and can't be upgraded
  in-place — the client must fetch a fresh token and rejoin/renew after a
  promotion or demotion

### What Layer 6 reuses from Layer 1 (nothing duplicated)

The roadmap called for "room roles (owner/admin/speaker/listener),
mute/unmute, hand raise, kick" as Layer 6 features — **all of that already
exists in Layer 1's `roomService.js`/`roomHandlers.js`** (`room:setRole`,
`room:setMute`, `room:raiseHand`, `room:kick`). Layer 6 does not
reimplement any of it; it wires Agora's actual audio transport on top of
that pre-existing permission/role model, which is the correct order (get
the authorization model right first, attach the audio SDK to it second).

### Client integration pattern (Flutter, Layer 7)

1. Join a room via Layer 1's `room:join` socket event (as before)
2. Call `POST /api/voice/token` with `{ roomId }` to get `{ appId, channelName, token, uid, canPublish }`
3. Initialize the Agora SDK (`agora_rtc_engine` Flutter package) with `appId`
4. Call `joinChannel` with the returned `token`, `channelName`, and `uid`
5. Set local audio publish based on `canPublish` (listeners join
   subscribe-only)
6. On receiving `voice:roleChanged`, repeat steps 2-4 to get a fresh token
   reflecting the new role
7. Wire Agora's `onAudioVolumeIndication` callback to emit
   `voice:activity` at a throttled rate; listen for the same event from
   other room members to drive speaking-indicator animations

## NOT included yet (later layers)

- Flutter client, 3D avatars — Layer 7

## Setup

```bash
cd backend
cp .env.example .env
# IMPORTANT: replace JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in .env with
# real random values before anything beyond local dev testing:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install

# Start Redis + Postgres
docker compose up -d

# Wait a few seconds for Postgres to be ready, then apply migrations
npm run migrate

# Start the server
npm run dev      # with nodemon, auto-restart on change
# or
npm start
```

Server boots on `http://localhost:4000` by default. It will refuse to start
if Redis OR Postgres is unreachable (fail-fast, checked at boot).

## Verifying it works

### 1. Health check

```bash
curl http://localhost:4000/healthz
# {"status":"ok","uptime":1.23,"timestamp":...,"redis":"ok"}
```

### 2. Room lifecycle smoke test (Layer 1)

This exercises the entire room lifecycle — create, join, roles, hand-raise,
disconnect/reconnect, leave, room teardown — against a live server.

**Note:** as of Layer 2, sockets require a real JWT (see below), so
`test/smoke.js` from Layer 1 will now fail auth with its old fake-token
shape. Use `test/smoke_auth.js` (below) instead — it registers real users
via the HTTP API first, then uses the resulting access tokens for socket
connections, exercising both layers together end-to-end.

### 3. Auth + integrated room smoke test (Layer 2 — run this one)

Exercises: register, duplicate-email rejection, login, wrong-password
rejection, refresh token rotation, **refresh token reuse detection** (theft
protection), full family revocation after reuse, an authenticated socket
connection created from the access token, room creation via that socket,
and rejection of a garbage token.

```bash
# terminal 1
docker compose up -d
npm run migrate
npm run dev

# terminal 2
npm install socket.io-client node-fetch@2 --no-save
node test/smoke_auth.js
```

Expected output ends with `✅ All Layer 2 auth assertions passed`. Every
assertion prints as it passes so you can see exactly which behavior was
verified — if one fails, the script stops immediately at that assertion
with a clear message.

### 5. Economy smoke test (Layer 4 — run this one too)

Exercises: daily reward claim + duplicate-claim rejection, insufficient
balance rejection, gift send with correct 70/30 split, ledger history
accuracy, mission auto-completion + claim + double-claim rejection.

```bash
node test/smoke_economy.js
```

Expected output ends with `✅ All Layer 4 economy assertions passed`. Note
printed at the end: the Stripe purchase path is NOT exercised by this
script (needs real Stripe test-mode credentials + the Stripe CLI to
forward webhooks) — verify that manually with `stripe listen --forward-to
localhost:4000/api/webhooks/stripe` per Stripe's docs.

### 8. Game engine tests (Layer 5 — actually executed, not just syntax-checked)

Unlike every other test in this repo, this one requires **no setup at
all** — no Docker, no Postgres, no Redis, no server running — because the
game engines are pure functions.

```bash
node test/game_engines.test.js
```

Expected output ends with `✅ All 19 game engine assertions passed`. These
exact 19 assertions were run during development and passed.

### 9. Live game smoke test (integration — NOT run by the assistant)

No integration-level smoke test exercising `game:start` /
`game:spy:describe` / etc. over real sockets has been written yet for this
layer (unlike Layers 1/2/4, which each have one). The pure-logic coverage
above is solid; the socket/Redis wiring in `gameHandlers.js` has only been
syntax-checked. Recommended before trusting this layer in production: play
through one full game of each type manually via two or more browser tabs
or a simple test client, or write a `test/smoke_games.js` following the
pattern of `test/smoke_auth.js`.

### 10. Migration verification

```bash
npm run migrate
# Run it a second time - should log "already applied, skipping" for every
# file and exit 0, proving migrations are idempotent/safe to re-run.
npm run migrate
```

### 11. Manual poke via curl (lobby listing)

```bash
curl http://localhost:4000/api/rooms
```

## Socket event reference

All events use an acknowledgement callback pattern: `socket.emit(event, payload, (response) => {...})`.
`response.ok === true` on success; on failure the server also emits a generic
`error` event with `{ code, message }`.

| Event | Payload | Ack response |
|---|---|---|
| `room:create` | `{ name, visibility, password?, maxMembers? }` | `{ ok, room }` |
| `room:join` | `{ roomId, password? }` | `{ ok, room }` |
| `room:leave` | `{ roomId }` | `{ ok, removed, roomDeleted, newOwnerId }` |
| `room:setRole` | `{ roomId, targetUserId, newRole }` | `{ ok, member }` |
| `room:setMute` | `{ roomId, targetUserId, muted }` | `{ ok, member }` |
| `room:raiseHand` | `{ roomId, raised }` | `{ ok, member }` |
| `room:kick` | `{ roomId, targetUserId }` | `{ ok, removed, roomDeleted }` |
| `presence:heartbeat` | `{}` | — |

Broadcast (server → room) events: `room:state`, `room:memberJoined`,
`room:memberLeft`, `room:memberUpdated`, `room:kicked` (sent directly to the
kicked user's socket).

## Economy REST reference (`/api/economy`, all require auth)

| Endpoint | Method | Notes |
|---|---|---|
| `/wallet` | GET | Current coins/diamonds |
| `/wallet/history` | GET | Paginated ledger entries |
| `/gifts/catalog` | GET | Active gifts |
| `/gifts/send` | POST | `{ receiverId, giftSlug, roomId? }` |
| `/gifts/room/:roomId` | GET | Recent gifts sent in a room |
| `/daily-reward/status` | GET | Streak info, next reward |
| `/daily-reward/claim` | POST | Once per calendar day |
| `/missions/today` | GET | Today's mission progress |
| `/missions/claim` | POST | `{ missionKey }` |
| `/purchases/packages` | GET | Diamond package list |
| `/purchases/create-intent` | POST | `{ packageKey }` → Stripe client secret |
| `/purchases/history` | GET | Past orders |

`/api/webhooks/stripe` (no auth — verified by Stripe signature instead).

## Config

See `.env.example` for all tunables — room capacity, reconnect grace period,
presence TTL, rate limits.

## Architecture notes

- **Single-room-per-user model**: a user can only be in one room at a time
  (`user:{userId}:room` in Redis enforces this). Joining a second room while
  in one fails with `ALREADY_IN_ROOM`.
- **Reconnect grace period**: on disconnect, the member is marked
  `connected: false` but stays in the room. A timer (`RECONNECT_GRACE_SECONDS`,
  default 30s) is scheduled to fully remove them. If they reconnect and
  re-join before it fires, the timer is cancelled and their seat/role is
  preserved.
- **Atomicity**: room join capacity checks use a Lua script to avoid a
  race between "check if full" and "add member" under concurrent joins.
- **Horizontal scaling**: the Socket.io Redis adapter means multiple backend
  instances behind a load balancer will correctly deliver room broadcasts to
  sockets connected to *any* instance, not just the one handling the request.

## Honest limitations of this layer

- **Not executed in a live environment by the assistant.** No network
  egress or local Postgres/Redis was available in the sandbox that built
  this, so `npm install`, the migration runner, and all smoke tests have
  only been **syntax-checked** (`node --check`), not run. Run
  `test/smoke_auth.js` and `test/smoke_economy.js` yourself and report any
  failures.
- Apple Sign-In requires `fullName` to be passed by the client on the
  *first* authorization only (Apple's own limitation, not this server's) —
  the client app must capture and forward it then, or the user's display
  name will fall back to their username.
- No email verification flow is implemented yet (`email_verified` exists in
  the schema but nothing sends a verification email) — acceptable for
  early development, not for production launch.
- No password reset flow yet.
- The gift receiver-share ratio (70%) is a hardcoded constant
  (`giftService.RECEIVER_SHARE_RATIO`), not yet exposed as an admin-tunable
  "economy control" — the roadmap mentioned adjustable gift values/prices
  in the dashboard; that wiring doesn't exist yet.
- Stripe integration has only been reviewed against Stripe's documented
  API shape from training data, not tested against a live Stripe account —
  double-check current PaymentIntent/webhook API details against Stripe's
  docs before going live, since Stripe's SDK does change over time.
- `verifyBalanceIntegrity()` exists but nothing calls it automatically yet
  (no scheduled reconciliation job) — worth wiring into a cron job before
  production.
- **Game socket/Redis integration (`gameHandlers.js`, `gameSessionService.js`,
  `gameTimer.js`) has only been syntax-checked, not run against a live
  server** — in contrast to the pure engine logic, which was genuinely
  executed and passed 19/19 assertions. Play-test each game end-to-end
  before trusting phase transitions, timer expiry, and the CAS retry logic
  under real concurrent socket traffic.
- Game timers are in-process only (not Redis-backed) — a server
  restart or failover mid-game silently abandons that game's timer; the
  session data would still be in Redis but nothing would ever advance its
  phase again. Acceptable for this layer; a production deployment running
  multiple backend instances behind the Redis adapter would need a more
  durable timer mechanism (e.g. a Redis-backed scheduled job) to survive
  instance failover.
- No spectator mode — every room member is assumed to be a player; there's
  no "watch without playing" path.
- Mafia's role distribution is fixed by player count (`computeRoleDistribution`)
  with no admin/host customization (e.g. choosing 2 mafia for an 8-player
  game) yet.
- **`agora-token` could not be installed or exercised in this sandbox** (no
  network access) — `voiceService.js`'s token-building call
  (`RtcTokenBuilder.buildTokenWithUid`) is unverified against the real
  package; only the pure, dependency-free parts (the uid-derivation hash
  function, the role-mapping logic) were actually executed and confirmed
  correct. Get real Agora App ID/Certificate from
  console.agora.io, run `npm install`, and test token issuance +
  an actual Agora SDK join before trusting this layer.
- No server-side recording/moderation of voice content — Agora offers a
  Cloud Recording API that isn't wired up here; if content moderation of
  voice rooms is a requirement, that's a separate integration.
- The Agora uid-derivation hash has a theoretical (astronomically small at
  realistic user counts) collision chance between two different userIds
  mapping to the same 32-bit uid; not addressed with a collision-check
  since the practical risk at any realistic scale is negligible, but worth
  knowing it's not cryptographically collision-proof.

## Next: Layer 7

UI/UX + 3D Avatars — the Flutter mobile client that actually consumes
everything built in Layers 1-6: screens, navigation, state management,
dark theme design system, micro-interactions, and Three.js/Ready-Player-Me
avatar customization.
