-- Push notification subscriptions for Web Push API.
--
-- Each row stores a user's push subscription (endpoint + keys) encrypted
-- with the same AES-256-GCM scheme used for Pix keys (src/lib/crypto.ts).
-- The server decrypts at send time in the Node.js runtime.
--
-- A user may have multiple subscriptions (one per device/browser).
-- Stale subscriptions (HTTP 410 from push service) are deleted by the
-- send logic in the API route.

-- ============================================================
-- PUSH_SUBSCRIPTIONS
-- ============================================================

CREATE TABLE push_subscriptions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription        text        NOT NULL,  -- AES-256-GCM encrypted JSON (PushSubscription)
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own subscriptions
CREATE POLICY push_subscriptions_select ON push_subscriptions
  FOR SELECT USING (user_id = auth.uid());

-- Users can only insert their own subscriptions
CREATE POLICY push_subscriptions_insert ON push_subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can only delete their own subscriptions
CREATE POLICY push_subscriptions_delete ON push_subscriptions
  FOR DELETE USING (user_id = auth.uid());

-- Service role (used by push-notify server logic) bypasses RLS automatically.
-- No UPDATE policy needed — subscriptions are immutable. If a subscription
-- changes (e.g. browser re-subscribes), delete the old row and insert a new one.
