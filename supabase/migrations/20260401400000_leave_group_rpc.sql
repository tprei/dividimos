-- Self-removal RPC: allows an accepted member to leave a group voluntarily.
--
-- Checks:
-- 1. Caller is authenticated
-- 2. Group exists
-- 3. Caller is not the group creator (creator cannot leave their own group)
-- 4. Caller is an accepted member of the group
-- 5. Caller has no outstanding balances in the group
--
-- On success: deletes zero-balance rows for the user and removes the
-- group_members entry.

CREATE OR REPLACE FUNCTION public.leave_group(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_group_creator uuid;
  v_member_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Look up the group
  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  -- Creator cannot leave their own group
  IF v_caller = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: group creator cannot leave the group';
  END IF;

  -- Check membership status
  SELECT status INTO v_member_status
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: you are not a member of this group';
  END IF;

  IF v_member_status != 'accepted' THEN
    RAISE EXCEPTION 'not_accepted: only accepted members can leave a group (use decline for invitations)';
  END IF;

  -- Block if the user has outstanding balances
  IF public.has_outstanding_balance(p_group_id, v_caller) THEN
    RAISE EXCEPTION 'has_outstanding_balance: you have unsettled debts in this group';
  END IF;

  -- Clean up zero-balance rows for this user in the group
  DELETE FROM public.balances
  WHERE group_id = p_group_id
    AND (user_a = v_caller OR user_b = v_caller)
    AND amount_cents = 0;

  -- Remove the membership row
  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;
