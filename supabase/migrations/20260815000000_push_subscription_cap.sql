-- Cap push subscriptions per user to prevent unbounded storage and
-- notification fan-out. Without a cap, a single user can accumulate
-- unlimited device subscriptions, each of which triggers a concurrent
-- network call (FCM or Web Push) on every notifyUser invocation.
--
-- The trigger rejects INSERTs when the user already has 5 subscriptions.
-- Stale subscriptions are cleaned up by the notifyUser dispatcher when
-- delivery fails, so the cap blocks only excessive accumulation.

CREATE OR REPLACE FUNCTION public.enforce_push_subscription_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Lock the parent user row so concurrent inserts for the same user
  -- serialize. Without this, two concurrent triggers can each read a
  -- count of 4 and both allow a 5th insert under READ COMMITTED.
  PERFORM 1 FROM public.users WHERE id = NEW.user_id FOR UPDATE;

  SELECT count(*) INTO v_count
    FROM public.push_subscriptions
   WHERE user_id = NEW.user_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'subscription_cap_exceeded'
      USING ERRCODE = 'PST09';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_push_subscription_cap ON public.push_subscriptions;
CREATE TRIGGER enforce_push_subscription_cap
  BEFORE INSERT ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_push_subscription_cap();
