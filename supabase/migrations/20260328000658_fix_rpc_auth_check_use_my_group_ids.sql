-- No-op: this migration was applied to remote via MCP to fix the auth check
-- in sync_group_settlements. The fix (using my_group_ids() instead of querying
-- group_members directly) is already included in the local version of
-- 20260327000005_fix_settlement_constraint_and_locking.sql.
--
-- This file exists only to keep the local migration history in sync with remote.

CREATE OR REPLACE FUNCTION public.sync_group_settlements(
  p_group_id UUID,
  p_edges JSONB DEFAULT '[]'::JSONB
)
RETURNS SETOF public.group_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  edge JSONB;
  v_from UUID;
  v_to UUID;
  v_amount INTEGER;
  v_settled INTEGER;
  v_remaining INTEGER;
BEGIN
  IF p_group_id NOT IN (SELECT public.my_group_ids()) THEN
    RAISE EXCEPTION 'Not a member of this group'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(1, hashtext(p_group_id::text));

  DELETE FROM public.group_settlements
  WHERE group_id = p_group_id
    AND status = 'pending';

  FOR edge IN SELECT * FROM jsonb_array_elements(p_edges)
  LOOP
    v_from := (edge ->> 'from_user_id')::UUID;
    v_to := (edge ->> 'to_user_id')::UUID;
    v_amount := (edge ->> 'amount_cents')::INTEGER;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_settled
    FROM public.group_settlements
    WHERE group_id = p_group_id
      AND from_user_id = v_from
      AND to_user_id = v_to
      AND status != 'pending';

    v_remaining := v_amount - v_settled;

    IF v_remaining > 1 THEN
      INSERT INTO public.group_settlements (group_id, from_user_id, to_user_id, amount_cents)
      VALUES (p_group_id, v_from, v_to, v_remaining);
    END IF;
  END LOOP;

  RETURN QUERY
    SELECT * FROM public.group_settlements
    WHERE group_id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_group_settlements(UUID, JSONB) TO authenticated;
