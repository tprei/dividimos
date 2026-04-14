-- Add notification_preferences JSONB column to users table.
-- Each key controls a category of push notifications.
-- Default: all categories enabled (empty object = all on).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb
    NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.notification_preferences IS
  'Per-category push notification opt-out. Keys: expenses, settlements, nudges, groups, messages. Missing key = enabled.';
