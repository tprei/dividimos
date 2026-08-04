-- Add notification_sent_at to settlements for one-shot notification claims.
-- The push notification server action atomically sets this timestamp only
-- for the first caller, preventing duplicate notifications from replay
-- or concurrent invocations. NULL means the notification has not been sent.

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS notification_sent_at timestamptz;

COMMENT ON COLUMN public.settlements.notification_sent_at IS
  'Set atomically by the notification server action on first delivery; NULL means not yet notified';
