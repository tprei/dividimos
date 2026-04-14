-- Add channel discriminator to push_subscriptions.
--
-- Distinguishes between W3C Web Push subscriptions ('web') and
-- Firebase Cloud Messaging native tokens ('fcm').
-- Defaults to 'web' for backward compatibility with existing rows.

ALTER TABLE push_subscriptions
  ADD COLUMN channel text NOT NULL DEFAULT 'web'
  CHECK (channel IN ('web', 'fcm'));

COMMENT ON COLUMN push_subscriptions.channel IS
  'Push channel: "web" for W3C Web Push (VAPID), "fcm" for Firebase Cloud Messaging native tokens';
