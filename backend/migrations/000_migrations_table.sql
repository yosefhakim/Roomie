-- Migration 000: bootstrap the migrations tracking table itself.
-- The runner (src/db/migrate.js) ensures this exists before applying
-- numbered migrations, and this file is applied first by filename sort.

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
