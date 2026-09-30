-- Scans the table without blocking writes now that oversized rows are gone.
SET lock_timeout = '5s';

ALTER TABLE public.push_subscriptions
  VALIDATE CONSTRAINT push_subscriptions_encrypted_size;
