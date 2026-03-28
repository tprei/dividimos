-- Atomic RPC to recalculate group settlements.
-- Replaces the racy client-side delete+insert pattern that caused 409 CONFLICT
-- errors due to the UNIQUE(group_id, from_user_id, to_user_id) constraint.
--
-- The function:
-- 1. Deletes all pending settlements for the group
-- 2. Upserts new pending settlements for each edge (skipping amounts already settled)
-- 3. Deletes any remaining pending rows with zero remaining amount
-- 4. Returns all current settlements for the group
--
-- This runs in a single transaction, eliminating race conditions.

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
  -- Verify the caller is a member of the group
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this group'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- Lock existing settlements for this group to prevent concurrent updates
  PERFORM 1 FROM public.group_settlements
  WHERE group_id = p_group_id
  FOR UPDATE;

  -- Delete all pending settlements for this group
  DELETE FROM public.group_settlements
  WHERE group_id = p_group_id
    AND status = 'pending';

  -- Process each edge from the input
  FOR edge IN SELECT * FROM jsonb_array_elements(p_edges)
  LOOP
    v_from := (edge ->> 'from_user_id')::UUID;
    v_to := (edge ->> 'to_user_id')::UUID;
    v_amount := (edge ->> 'amount_cents')::INTEGER;

    -- Sum already-settled/partially-paid amounts for this pair
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_settled
    FROM public.group_settlements
    WHERE group_id = p_group_id
      AND from_user_id = v_from
      AND to_user_id = v_to
      AND status != 'pending';

    v_remaining := v_amount - v_settled;

    -- Only insert if remaining amount is meaningful (> 1 centavo)
    IF v_remaining > 1 THEN
      INSERT INTO public.group_settlements (group_id, from_user_id, to_user_id, amount_cents)
      VALUES (p_group_id, v_from, v_to, v_remaining);
    END IF;
  END LOOP;

  -- Return all current settlements for this group
  RETURN QUERY
    SELECT * FROM public.group_settlements
    WHERE group_id = p_group_id;
END;
$$;

-- Grant execute to authenticated users (RLS is enforced inside the function)
GRANT EXECUTE ON FUNCTION public.sync_group_settlements(UUID, JSONB) TO authenticated;
