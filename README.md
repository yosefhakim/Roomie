# Roomie

A real-time multiplayer social gaming platform: voice-chat rooms, three
built-in games (Who's the Spy, Mafia/Werewolf, Draw & Guess), a virtual
economy, and 3D avatars. Built in 7 layers, each with its own README and
its own honesty about what's verified vs. not.

```
roomie/
├── backend/            Layers 1-6: Node.js + Express + Socket.io + Redis + Postgres
├── admin-dashboard/    Layer 3: React + Tailwind admin panel
└── frontend/           Layer 7: Flutter mobile client
```

## Start here

1. **`backend/README.md`** — the backend covers Layers 1 (rooms/sockets),
   2 (auth), 3 (admin API), 4 (economy), 5 (games), 6 (voice). Read this
   first; it has setup instructions, a full endpoint/event reference, and
   an honest-limitations section **for each layer**.
2. **`admin-dashboard/README.md`** — Layer 3's frontend.
3. **`frontend/README.md`** — Layer 7. **Read this one especially
   carefully** — it's the least-verified part of the project (no Dart/
   Flutter toolchain was available while building it) and says so
   directly, with a precise account of what was and wasn't checked.

## Quickest path to a running system

```bash
# 1. Backend
cd backend
cp .env.example .env
npm install
docker compose up -d          # Redis + Postgres
npm run migrate
npm run dev                    # http://localhost:4000

# 2. Verify the backend actually works (run these - don't skip)
node test/game_engines.test.js       # instant, zero setup, real assertions
node test/smoke.js                    # Layer 1 (needs socket.io-client)
node test/smoke_auth.js               # Layer 2
node test/smoke_economy.js            # Layer 4

# 3. Admin dashboard
cd ../admin-dashboard
cp .env.example .env
npm install
npm run dev                    # http://localhost:5173
# create an admin user: UPDATE users SET is_admin = true WHERE email = '...';

# 4. Mobile client (requires Flutter SDK)
cd ../frontend
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:4000
```

## What's real vs. what's unverified — the short version

This project was built incrementally with an actual verification step at
every layer, not just written and assumed correct. The level of
verification differs by what was actually possible in the sandbox it was
built in (no network access, no Flutter/Dart toolchain, no live Postgres/
Redis/Stripe/Agora credentials):

| Layer | What was verified |
|---|---|
| 1. Core server | Syntax-checked (`node --check`); a runnable smoke test written for you to execute |
| 2. Auth | Syntax-checked; runnable smoke test covering the full token-rotation/reuse-detection flow |
| 3. Admin API + dashboard | Backend syntax-checked; dashboard JSX manually reviewed only — **no JSX compiler was available** |
| 4. Economy | Syntax-checked; runnable smoke test covering ledger math, gift transfer, missions |
| 5. Game logic | **Actually executed**, not just syntax-checked — the three pure game engines ran real full-game simulations during development, and a 19-assertion test suite (`test/game_engines.test.js`) reproduces this in seconds with zero setup |
| 6. Voice (Agora) | Syntax-checked; the pure uid-derivation logic was executed and verified; `agora-token`'s actual token-building call is unverified (package unavailable, no network) |
| 7. Flutter client | **Not compiled or run** — no Dart toolchain available. Verified only via import-resolution and provider-reference scripts (see `frontend/README.md`) — genuinely the weakest-verified layer, and its README says so in detail |

Every layer's README has a "Honest limitations" section spelling out
exactly what wasn't checked and why, and what to verify yourself before
depending on it in production. Nothing here should be treated as
production-ready without going through that list.

## Architecture highlights worth knowing before you dig in

- **Every balance change flows through one function**
  (`economyService.applyLedgerEntry`) — coins/diamonds are never written
  anywhere else, so the wallet balance is always reconstructable from an
  append-only ledger, with idempotency keys protecting against duplicate
  Stripe webhook delivery.
- **Game state is redacted server-side, per-player, before it's ever
  sent** — a client never receives another player's hidden role or word
  and then hides it in the UI; the server simply never sends it. See
  `gameHandlers.js`'s `broadcastGameState`.
- **Every phase transition in every game is server-authoritative** —
  timers live on the server (`gameTimer.js`) and clients only render a
  countdown against a server-provided timestamp; they never decide a
  phase has ended.
- **Auth tokens rotate with reuse detection** — presenting an
  already-rotated refresh token revokes the entire token family, a real
  theft-response mechanism, not just an access-token TTL.
- **Voice publish rights are enforced at token issuance, not
  client-side** — a listener cannot obtain an Agora publisher token by
  tampering with the app; the mapping happens server-side in
  `voiceService.js`.

## Known gaps across the whole project (not sugar-coated)

- No CI pipeline, no automated test runner wiring the various `test/*`
  scripts together — they're meant to be run manually per the READMEs.
- No production deployment configs beyond the local `docker-compose.yml`
  for Redis+Postgres (no Nginx, no k8s manifests, no CDN setup for the
  avatar viewer's Three.js assets).
- No email verification or password-reset flow.
- The Flutter avatar customization screen calls a backend endpoint
  (`PATCH /api/users/me`) that doesn't exist yet — documented, not hidden.
- Load/scale testing has not been done anywhere in this project — the
  Redis adapter and connection pooling are configured for horizontal
  scaling, but that configuration itself is unverified under real load.

If you're picking this up to keep building: read each layer's README
before touching its code, run the smoke tests that exist, and treat every
"honest limitations" section as your actual TODO list, not boilerplate.
