-- Migration 002: admin audit trail + activity tracking for DAU/MAU analytics

BEGIN;

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id   UUID NOT NULL REFERENCES users(id),
    action          VARCHAR(50) NOT NULL,       -- e.g. 'ban_user', 'unban_user', 'grant_coins'
    target_user_id  UUID REFERENCES users(id),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON admin_audit_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at);

-- One row per (user, calendar day) they were active. Cheap upsert-on-login
-- approach to DAU/MAU rather than scanning session logs at query time.
CREATE TABLE IF NOT EXISTS user_activity_days (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_date   DATE NOT NULL,
    PRIMARY KEY (user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_user_activity_days_date ON user_activity_days(activity_date);

COMMIT;
