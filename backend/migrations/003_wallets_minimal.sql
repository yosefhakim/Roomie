-- Migration 003: minimal wallet balance, added early so Layer 3's admin
-- "grant/revoke coins" tooling has something real to operate on.
--
-- NOTE: this is intentionally minimal (balance only, no ledger). Layer 4
-- (Economy System) adds the full transaction ledger, atomic
-- increment/decrement with rollback, gift system, and daily rewards, and
-- will very likely migrate this table further (e.g. splitting into
-- coins/diamonds balances). Treat this as a placeholder sufficient for
-- admin balance adjustments, not the final economy schema.

BEGIN;

CREATE TABLE IF NOT EXISTS wallets (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    coins       BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_wallets_updated_at ON wallets;
CREATE TRIGGER trg_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
