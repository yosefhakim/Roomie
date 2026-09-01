-- Migration 004: Full economy system.
--
-- This SUPERSEDES the minimal `wallets` table from migration 003 (Layer 3
-- placeholder). We migrate its data forward rather than dropping it, then
-- redefine `wallets` to also track diamonds and a version counter used for
-- optimistic locking on top of the row-lock approach.

BEGIN;

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS diamonds BIGINT NOT NULL DEFAULT 0 CHECK (diamonds >= 0);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS lifetime_coins_earned BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS lifetime_diamonds_purchased BIGINT NOT NULL DEFAULT 0;

-- The append-only ledger is the source of truth for every balance change.
-- `wallets.coins`/`wallets.diamonds` are a materialized running total kept
-- in sync transactionally with each ledger insert (see economyService.js) -
-- never written to directly outside that service.
CREATE TABLE IF NOT EXISTS ledger_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency            VARCHAR(10) NOT NULL CHECK (currency IN ('coins', 'diamonds')),
    delta               BIGINT NOT NULL CHECK (delta <> 0),
    balance_after        BIGINT NOT NULL,
    reason              VARCHAR(40) NOT NULL,   -- e.g. 'gift_sent', 'gift_received', 'daily_reward', 'purchase', 'admin_grant', 'mission_reward', 'refund'
    reference_type      VARCHAR(40),            -- e.g. 'gift', 'stripe_order', 'mission', 'admin_action'
    reference_id        UUID,
    idempotency_key     TEXT UNIQUE,            -- prevents double-processing of the same external event (e.g. a retried Stripe webhook)
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_user ON ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_reference ON ledger_entries(reference_type, reference_id);

-- Gift catalog: what gifts exist, their price, and their animation asset key.
CREATE TABLE IF NOT EXISTS gift_catalog (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(40) UNIQUE NOT NULL,
    display_name    VARCHAR(60) NOT NULL,
    price_coins     BIGINT NOT NULL CHECK (price_coins >= 0),
    animation_key   VARCHAR(60) NOT NULL,       -- client-side lookup key for the Lottie/particle animation
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A sent gift event, referenced by two ledger entries (sender debit,
-- receiver credit - receiver gets a configurable share, platform keeps the rest).
CREATE TABLE IF NOT EXISTS gift_sends (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gift_id         UUID NOT NULL REFERENCES gift_catalog(id),
    sender_id       UUID NOT NULL REFERENCES users(id),
    receiver_id     UUID NOT NULL REFERENCES users(id),
    room_id         UUID,                        -- Redis-backed room id (Layer 1), not an FK since rooms are ephemeral
    price_coins     BIGINT NOT NULL,
    receiver_share_coins BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_sends_sender ON gift_sends(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gift_sends_receiver ON gift_sends(receiver_id, created_at DESC);

-- Daily reward claims - one row per (user, calendar day) claimed, streak
-- computed from consecutive prior-day rows at claim time.
CREATE TABLE IF NOT EXISTS daily_reward_claims (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_date      DATE NOT NULL,
    streak_day      INT NOT NULL,               -- 1-7, cycles
    coins_awarded   BIGINT NOT NULL,
    PRIMARY KEY (user_id, claim_date)
);

-- Missions: simple counter-based objectives (e.g. "join 3 rooms today").
-- Definitions live in application config (missionService.js), not the DB,
-- since they're small in number and change with app releases; only
-- per-user progress is persisted.
CREATE TABLE IF NOT EXISTS mission_progress (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mission_key     VARCHAR(50) NOT NULL,
    period_key      VARCHAR(20) NOT NULL,       -- e.g. '2026-08-30' for daily missions
    progress        INT NOT NULL DEFAULT 0,
    target          INT NOT NULL,
    completed_at    TIMESTAMPTZ,
    reward_claimed  BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, mission_key, period_key)
);

-- Stripe purchase orders - one row per checkout/payment intent, tracks
-- lifecycle so webhooks are idempotent and reconcilable against Stripe's
-- own dashboard.
CREATE TABLE IF NOT EXISTS stripe_orders (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    stripe_payment_intent_id TEXT UNIQUE NOT NULL,
    diamonds_purchased      BIGINT NOT NULL,
    amount_cents            BIGINT NOT NULL,
    currency                VARCHAR(10) NOT NULL DEFAULT 'usd',
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending -> succeeded | failed | refunded
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_orders_user ON stripe_orders(user_id);

DROP TRIGGER IF EXISTS trg_stripe_orders_updated_at ON stripe_orders;
CREATE TRIGGER trg_stripe_orders_updated_at
    BEFORE UPDATE ON stripe_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed a small starter gift catalog so the system is usable out of the box.
INSERT INTO gift_catalog (slug, display_name, price_coins, animation_key, sort_order) VALUES
    ('rose', 'Rose', 10, 'gift_rose', 1),
    ('heart', 'Heart', 50, 'gift_heart', 2),
    ('crown', 'Crown', 500, 'gift_crown', 3),
    ('rocket', 'Rocket', 1000, 'gift_rocket', 4),
    ('diamond_ring', 'Diamond Ring', 5000, 'gift_diamond_ring', 5)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
