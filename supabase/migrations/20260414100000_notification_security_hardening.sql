-- Security hardening for notifications.
--
-- 1. Move notification_preferences out of the users table into its own
--    table with own-row-only RLS, closing the co-member read leak.
-- 2. Create nudge_log for server-side rate limiting of payment nudges.
-- 3. Cap push_subscriptions per user (enforced via trigger).

-- ============================================================
-- 1. NOTIFICATION_PREFERENCES TABLE
-- ============================================================

CREATE TABLE notification_preferences (
  user_id     uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Migrate existing data
INSERT INTO notification_preferences (user_id, preferences)
SELECT id, notification_preferences
FROM users
WHERE notification_preferences != '{}'::jsonb
ON CONFLICT DO NOTHING;

-- Drop the column from users — no longer needed there
ALTER TABLE users DROP COLUMN IF EXISTS notification_preferences;

-- RLS: own-row only
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select ON notification_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY notification_preferences_insert ON notification_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY notification_preferences_update ON notification_preferences
  FOR UPDATE USING (user_id = auth.uid());

-- Service role bypasses RLS for server-side preference checks.

-- ============================================================
-- 2. NUDGE_LOG (server-side rate limiting)
-- ============================================================

CREATE TABLE nudge_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nudge_log_lookup
  ON nudge_log (from_user, to_user, group_id, created_at DESC);

-- RLS: no direct client access — only the server (admin client) writes/reads
ALTER TABLE nudge_log ENABLE ROW LEVEL SECURITY;
-- No policies = no client access. Service role bypasses.

-- Auto-prune entries older than 24 hours on insert (keeps table small)
CREATE OR REPLACE FUNCTION prune_old_nudges() RETURNS trigger AS $$
BEGIN
  DELETE FROM nudge_log WHERE created_at < now() - interval '24 hours';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prune_old_nudges
  AFTER INSERT ON nudge_log
  FOR EACH STATEMENT EXECUTE FUNCTION prune_old_nudges();

-- ============================================================
-- 3. PUSH SUBSCRIPTION CAP (max 20 per user)
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_push_subscription_limit() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM push_subscriptions WHERE user_id = NEW.user_id) >= 20 THEN
    RAISE EXCEPTION 'push_subscription_limit_exceeded'
      USING HINT = 'Maximum 20 push subscriptions per user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_push_subscription_limit
  BEFORE INSERT ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION enforce_push_subscription_limit();
