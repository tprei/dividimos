-- #483: bind push delivery capabilities to the active account.
--
-- AES-256-GCM with a random IV makes the existing `subscription` ciphertext
-- non-deterministic, so the routes dedupe only within the current user and a
-- subscription survives sign-out — leaking A's notifications onto B's device.
-- This migration adds a deterministic, cross-user `fingerprint` column with a
-- uniqueness constraint that spans users, plus atomic claim/transfer and
-- owner-scoped release RPCs that replace the client-side decrypt-and-compare
-- loops.

-- Existing rows cannot be fingerprinted in SQL (their ciphertext is
-- non-deterministic), so they are dropped. Every live capability re-registers
-- automatically on the next authenticated app open (see use-push-notifications),
-- so nothing is lost except stale cross-account bindings.
DELETE FROM public.push_subscriptions;

ALTER TABLE public.push_subscriptions ADD COLUMN fingerprint text NOT NULL;

-- One authoritative owner per physical capability, across all users.
CREATE UNIQUE INDEX push_subscriptions_channel_fingerprint_key
  ON public.push_subscriptions (channel, fingerprint);

-- Extend the per-user cap so a transfer cannot bypass it. The UPDATE path is
-- now reachable (claim_push_subscription transfers ownership via
-- ON CONFLICT DO UPDATE), so the trigger fires BEFORE INSERT OR UPDATE OF
-- re-claim (refresh) free, and `id IS DISTINCT FROM NEW.id` keeps the INSERT
-- semantics identical to #492 (the new row is not yet visible to its own
-- count) while making the UPDATE path count correctly. Because Postgres fires
-- the BEFORE INSERT trigger even when an ON CONFLICT DO UPDATE will redirect
-- to the UPDATE path, the INSERT branch skips the cap count when the
-- (channel, fingerprint) already exists — that row is governed by the UPDATE
-- path's NEW.user_id = OLD.user_id short-circuit, so a same-owner re-claim at
-- the cap succeeds while a cross-owner transfer at the cap still raises PST09.
CREATE OR REPLACE FUNCTION public.enforce_push_subscription_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id = OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.push_subscriptions
     WHERE channel = NEW.channel AND fingerprint = NEW.fingerprint
  ) THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.users WHERE id = NEW.user_id FOR UPDATE;
  SELECT count(*) INTO v_count
    FROM public.push_subscriptions
   WHERE user_id = NEW.user_id AND id IS DISTINCT FROM NEW.id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'subscription_cap_exceeded'
      USING ERRCODE = 'PST09';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_push_subscription_cap ON public.push_subscriptions;
CREATE TRIGGER enforce_push_subscription_cap
  BEFORE INSERT OR UPDATE OF user_id ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_push_subscription_cap();

-- Atomic claim/transfer. ON CONFLICT DO UPDATE under the unique index is the
-- whole concurrency story: two racing claims on the same (channel, fingerprint)
-- serialize on the row lock, leaving exactly one owner. SECURITY DEFINER is
-- required because RLS has no UPDATE policy and the conflicting row may belong
-- to another user; ownership is still auth.uid(), never a caller-supplied id.
CREATE OR REPLACE FUNCTION public.claim_push_subscription(
  p_channel text, p_fingerprint text, p_subscription text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;
  IF p_channel NOT IN ('web','fcm') THEN
    RAISE EXCEPTION 'invalid_channel' USING ERRCODE = 'PST02';
  END IF;
  INSERT INTO public.push_subscriptions (user_id, channel, fingerprint, subscription)
  VALUES (v_uid, p_channel, p_fingerprint, p_subscription)
  ON CONFLICT (channel, fingerprint) DO UPDATE
    SET user_id = v_uid, subscription = EXCLUDED.subscription, created_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_push_subscription(text,text,text) TO authenticated;

-- Owner-scoped release. The user_id = auth.uid() predicate means knowing a
-- fingerprint does not let one account unbind another's capability.
CREATE OR REPLACE FUNCTION public.release_push_subscription(
  p_channel text, p_fingerprint text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;
  WITH d AS (
    DELETE FROM public.push_subscriptions
     WHERE channel = p_channel AND fingerprint = p_fingerprint AND user_id = v_uid
     RETURNING 1
  )
  SELECT count(*)::integer INTO v_deleted FROM d;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_push_subscription(text,text) TO authenticated;
