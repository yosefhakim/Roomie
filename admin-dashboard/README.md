# Roomie Admin Dashboard (Layer 3)

React + Vite + Tailwind admin panel: real-time-ish analytics (DAU/MAU,
signups), user management (search, ban/unban, grant/revoke coins), room
moderation (view live rooms, force-close with member eviction), and a full
audit log of every admin action.

## What's included

- Login page — authenticates against the same `/api/auth/login` endpoint
  as regular users, then checks `user.isAdmin` client-side (the backend
  independently re-verifies `is_admin` on every `/api/admin/*` request via
  `requireAdmin` middleware — the client-side check is only for UX, not security)
- Axios client with automatic access-token refresh on 401 (single-flight,
  so concurrent requests don't trigger duplicate refresh calls)
- Overview page: total/banned/admin user counts, DAU, MAU, active room
  count, 30-day DAU and signup charts (Recharts)
- Users page: paginated + searchable table, ban (with required reason,
  revokes all sessions immediately), unban, coin grant/revoke (with
  required reason, both logged to the audit trail)
- Rooms page: live grid of active rooms with member avatars and connection
  status, force-close (broadcasts `room:forceClosed` to evict members via
  the socket layer before tearing down Redis state)
- Audit Log page: chronological feed of every admin action with actor,
  target, and reason

Polling interval is 5-30s per page (see `usePolling` hook) rather than a
socket subscription — simpler to reason about and sufficient freshness for
an admin panel. Swap in a socket subscription later if sub-second updates
become necessary.

## Setup

```bash
cd admin-dashboard
cp .env.example .env
npm install
npm run dev
```

Opens on `http://localhost:5173`. The Vite dev server proxies `/api/*` to
the backend (`http://localhost:4000` by default — see `vite.config.js` /
`VITE_API_PROXY_TARGET`).

**Prerequisite:** Layers 1+2 backend must be running (`docker compose up -d
&& npm run migrate && npm run dev` in `/backend`), and you need at least
one admin user. There is no signup-as-admin flow by design (nobody should
be able to self-promote); create one manually:

```sql
-- after registering a normal account through the app/API, promote it:
UPDATE users SET is_admin = true WHERE email = 'you@example.com';
```

## Honest limitations of this layer

- **Not built or run.** This sandbox has no network access, so `npm
  install` could not fetch React/Vite/Tailwind/Recharts, and there is no
  local JSX-capable parser available to typecheck or compile these files
  the way `node --check` verified the backend's plain JS. Every `.jsx`
  file here has been manually re-read for balanced tags, matching
  imports/exports, and consistent hook usage, but **it has not been
  proven to compile or run.** Run `npm run dev` yourself before trusting
  this layer, and tell me what breaks — component-level bugs are very
  plausible on a first pass this size.
- The wallet backing "grant/revoke coins" (`walletRepositoryMinimal.js`,
  migration 003) is intentionally minimal — balance only, no transaction
  ledger. Layer 4 replaces it with the real economy system; the admin UI's
  coin endpoints will likely need small adjustments (e.g. to log through
  the new ledger) when that lands.
- No dashboard-side test suite yet (no Cypress/Playwright/RTL tests) —
  matches the "manual smoke test over automated CI" approach used in
  Layers 1-2, but is worth formalizing before production.
- No pagination on the audit log UI (loads latest 100, no "load more" yet).

## Next: Layer 4

Economy System — coins/diamonds with a full atomic transaction ledger,
gift system, daily rewards/missions, Stripe payment integration. Will
replace `walletRepositoryMinimal.js` and extend the admin coin-adjustment
flow to write through the new ledger instead of a bare balance column.
