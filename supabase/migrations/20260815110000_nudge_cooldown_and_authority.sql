-- Server-side nudge authority, balance verification, and cooldown.
-- The claim_nudge RPC is the sole authority for payment nudges: it
-- verifies accepted membership, reads the committed directed balance,
-- enforces a 24-hour cooldown, and returns the owed amount — all in one
-- atomic operation. The push notification server action calls this RPC
-- and only sends if it returns a row.

CREATE TABLE IF NOT EXISTS public.nudge_cooldowns (
  group_id    uuid        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  creditor_id uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  debtor_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  nudged_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, creditor_id, debtor_id)
);

ALTER TABLE public.nudge_cooldowns ENABLE ROW LEVEL SECURITY;

-- Only the service role (used by server actions) accesses this table.
REVOKE ALL ON public.nudge_cooldowns FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_nudge(
  p_group_id uuid,
  p_debtor_id uuid
) RETURNS TABLE(amount_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_min_user   uuid;
  v_max_user   uuid;
  v_balance    integer;
  v_directed   integer;
  v_last_nudge timestamptz;
BEGIN
  IF v_caller IS NULL OR v_caller = p_debtor_id THEN
    RETURN;
  END IF;

  -- Caller must be an accepted member or creator of the group.
  IF p_group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RETURN;
  END IF;

  -- Enforce a 24-hour server-side cooldown. Lock the row so two
  -- concurrent calls for the same pair serialize.
  SELECT nudged_at INTO v_last_nudge
    FROM public.nudge_cooldowns
   WHERE group_id = p_group_id
     AND creditor_id = v_caller
     AND debtor_id = p_debtor_id
   FOR UPDATE;

  IF v_last_nudge IS NOT NULL AND now() - v_last_nudge < interval '24 hours' THEN
    RETURN;
  END IF;

  -- Read the committed directed balance.
  IF p_debtor_id < v_caller THEN
    v_min_user := p_debtor_id;
    v_max_user := v_caller;
  ELSE
    v_min_user := v_caller;
    v_max_user := p_debtor_id;
  END IF;

  SELECT b.amount_cents INTO v_balance
    FROM public.balances b
   WHERE b.group_id = p_group_id
     AND b.user_a = v_min_user
     AND b.user_b = v_max_user;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Directed amount the debtor owes the caller.
  v_directed := CASE WHEN v_min_user = p_debtor_id
    THEN v_balance
    ELSE -v_balance
  END;

  IF v_directed <= 0 THEN
    RETURN;
  END IF;

  -- Set or refresh the cooldown.
  INSERT INTO public.nudge_cooldowns (group_id, creditor_id, debtor_id, nudged_at)
  VALUES (p_group_id, v_caller, p_debtor_id, now())
  ON CONFLICT (group_id, creditor_id, debtor_id)
  DO UPDATE SET nudged_at = now();

  RETURN QUERY SELECT v_directed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_nudge(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_nudge(uuid, uuid) TO authenticated;
