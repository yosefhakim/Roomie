# Roomie Frontend — Layer 7 (Flutter Client + 3D Avatars)

The mobile client consuming everything built in Layers 1-6: auth, rooms,
economy, all three games, and voice chat.

## What's included

**Core networking** (`lib/core/network/`)
- `api_client.dart` — Dio-based REST client with automatic 401
  refresh-and-retry (single-flight, mirrors the exact pattern in
  `admin-dashboard/src/lib/api.js`)
- `socket_manager.dart` — Socket.IO connection lifecycle, typed event
  streams (`roomEvents`, `gameEvents`, `voiceEvents`) matching every
  broadcast the backend emits across Layers 1/5/6
- `token_storage.dart` — tokens in `flutter_secure_storage` (Keychain/
  EncryptedSharedPreferences), never plain storage

**State** (`lib/core/state/`) — Riverpod `StateNotifier`s: `auth_provider.dart`
(register/login/OAuth/logout/refresh), `room_provider.dart` (create/join/
leave/roles/mute/hand-raise/kick), `game_provider.dart` (all game actions
across all three games + canvas stroke relay), `voice_provider.dart`
(Agora RTC engine lifecycle, VAD relay, self-mute), `wallet_provider.dart`
(balance, gifts, daily reward)

**Screens**: login, register, lobby (browse/create rooms), room (member
grid with 3D avatars + speaking indicators, voice controls, game launch),
game (dispatches to per-game view), profile (wallet, daily reward,
logout), avatar customization (preset picker)

**Games**: `spy_game_view.dart`, `mafia_game_view.dart`,
`draw_guess_game_view.dart` — each renders exactly what its backend
engine's `redactStateForPlayer` sends (see `lib/models/game_state.dart`,
which mirrors those redaction shapes field-for-field), plus
`drawing_canvas.dart` (custom-painted canvas, stroke capture/relay/replay)

**Voice**: Agora RTC integration in `voice_provider.dart` following the
exact flow documented in `backend/README.md`'s "Client integration
pattern" section — fetch token, join channel, publish based on
`canPublish`, relay VAD, rejoin on `voice:roleChanged`

**3D avatars**: `avatar_3d_viewer.dart` + `assets/avatar_viewer/index.html`
— see the design-rationale doc comment in that file for why this is
WebView+Three.js rather than a native engine

## Setup

Requires the Flutter SDK (this sandbox does not have one — see
"Honest limitations" below).

```bash
cd frontend
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:4000
```

The backend (Layers 1-6) must be running first — see `backend/README.md`.

## Honest limitations of this layer

**This is the most important section in this README.** Read it before
trusting anything above.

- **Nothing in this directory has been compiled, run, or hot-reloaded.**
  This sandbox has no Flutter/Dart SDK and no network access to install
  one. Every other layer in this project got at least `node --check`
  (syntax verification); some (game engines, uid derivation) got genuinely
  *executed* and passed real assertions. This layer got neither. What it
  did get, and what that actually proves:
  - Every relative `import` across all 29 `.dart` files resolves to a real
    file on disk (verified with a script — this would have caught, and
    did catch during development, two missing screens the router
    referenced before they existed)
  - Every `ref.read/watch/listen(xProvider)` call references a provider
    that is actually declared somewhere (verified with a script)
  - Braces and parens are balanced in every file (a weak but real proxy
    for gross syntax errors)
  - None of this proves the code **type-checks** or **runs**. Dart's type
    system, null-safety analysis, and the actual API surface of every
    package version in `pubspec.yaml` (Riverpod, go_router, Agora,
    webview_flutter, etc.) are all unverified. Package APIs shift between
    versions in ways that would only surface via `flutter analyze` or
    `flutter run`, neither of which was possible here.
  - **Run `flutter analyze` before writing a single new feature on top of
    this, and expect to fix real errors it finds.** That is a normal part
    of picking this up, not a sign something went wrong.

- **The Agora RTC integration (`voice_provider.dart`) is the highest-risk
  file in this layer.** `agora_rtc_engine`'s actual Dart API (event
  handler signatures, `ChannelMediaOptions` fields, enum names) was
  written from training-data familiarity with the package, not verified
  against its current pub.dev version. Cross-check every call in that
  file against the installed package version's actual API before relying
  on it — package APIs like this one do change across major versions.

- **PATCH /api/users/me does not exist on the backend.** The avatar
  customization screen's save action calls it and will get a 404 — this
  is called out directly in `avatar_customization_screen.dart`'s comments
  and its catch block shows a message saying so, rather than silently
  pretending to succeed. Add that endpoint (and an `avatar_url` column,
  which already exists in the `users` table from migration 001, so this
  is a small addition) before this screen actually persists anything.

- **No avatar picker beyond 3 hardcoded sample URLs.** A real deployment
  needs either your own curated preset catalog (backend-served) or an
  embedded Ready Player Me creator flow (a WebView pointed at RPM's hosted
  creator UI, capturing the resulting model URL via `postMessage`) —
  neither exists here. See the doc comment in
  `avatar_customization_screen.dart` for the tradeoff.

- **Three.js and its GLTFLoader are loaded from a CDN (`unpkg.com`)
  inside the avatar WebView**, not bundled. This means avatar rendering
  requires network access at runtime and depends on that CDN's uptime —
  self-host these assets before shipping to production.

- **No offline handling, no reconnection backoff tuning beyond
  Socket.IO's defaults**, no test suite (no widget tests, no integration
  tests) for this layer, unlike the backend's smoke tests and the
  genuinely-executed game engine tests.

- **Performance of many simultaneous `Avatar3DViewer` WebViews in one grid
  is unverified** — a room with a dozen visible avatars means a dozen
  WebView-hosted Three.js contexts, which is a real resource concern
  flagged in that widget's own doc comment, not glossed over.

## Architecture notes worth knowing

- Every game view (`spy_game_view.dart` etc.) is a pure function of the
  redacted state the server sent — the client never has, and never needs,
  logic for "should I hide this from the player," because the server
  already decided that before the bytes left it (see `gameHandlers.js`'s
  `broadcastGameState`).
- The room's member grid drives both the 3D avatar AND the voice-speaking
  ring off the same `RoomMember`/`VoiceParticipantState` data — the visual
  and the audio are two views of the same underlying room state, not
  separately synchronized systems.
