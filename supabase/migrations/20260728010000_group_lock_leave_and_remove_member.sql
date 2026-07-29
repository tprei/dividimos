-- ============================================================
-- Issue #505: serialize leave_group and remove_group_member against
-- the group-row lock hierarchy already established for every other
-- balance-producing/membership RPC.
--
-- Both functions read `has_outstanding_balance(group_id, user_id)` (a
-- plain unlocked SELECT) and then delete the membership row, with
-- nothing serializing the gap between the check and the delete. A
-- concurrent balance-writing RPC (activate_expense, record_settlements,
-- confirm_settlement, claim_guest_spot) can commit a fresh nonzero
-- balance against that same user between the check and the delete,
-- because none of those RPCs contend for a lock these two functions
-- also take — they only verify the membership row still exists (also
-- unlocked), which it does until the DELETE actually commits.
--
-- Fix: lock the group row FOR UPDATE first, exactly like the other five
-- balance/membership RPCs already do (delete_group, confirm_settlement,
-- record_settlements, activate_expense, claim_guest_spot). This makes
-- leave_group/remove_group_member join the same serialization boundary,
-- so a concurrent balance write and an exit RPC can never interleave:
-- whichever acquires the group lock first determines the other's final
-- (possibly rejected) outcome deterministically.
--
-- Forward-only: CREATE OR REPLACE of both existing functions. No table
-- or column changes. Existing EXECUTE grants are preserved by CREATE OR
-- REPLACE. Authorization and balance-check semantics are unchanged;
-- only the lock ordering changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.remove_group_member(
  p_group_id uuid,
  p_user_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_group_creator uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock the group row (the root of the lock hierarchy) before any
  -- balance check or membership mutation, matching activate_expense,
  -- claim_guest_spot, confirm_settlement, record_settlements, and
  -- delete_group.
  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  -- Only the group creator can remove members
  IF v_caller != v_group_creator THEN
    RAISE EXCEPTION 'permission_denied: only the group creator can remove members';
  END IF;

  -- Cannot remove yourself (the creator)
  IF p_user_id = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: cannot remove the group creator';
  END IF;

  -- Check that the member actually exists in the group
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'member_not_found: user is not a member of this group';
  END IF;

  -- Block removal if the user has outstanding balances. The group lock
  -- held above means no concurrent activation/settlement/claim can
  -- commit a fresh balance for this user between this check and the
  -- delete below.
  IF public.has_outstanding_balance(p_group_id, p_user_id) THEN
    RAISE EXCEPTION 'has_outstanding_balance: member has unsettled debts in this group';
  END IF;

  -- All checks passed — delete the membership row
  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

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

  -- Lock the group row (the root of the lock hierarchy) before any
  -- balance check or membership mutation, matching activate_expense,
  -- claim_guest_spot, confirm_settlement, record_settlements,
  -- delete_group, and remove_group_member above.
  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  IF v_caller = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: group creator cannot leave the group';
  END IF;

  SELECT status INTO v_member_status
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: you are not a member of this group';
  END IF;

  IF v_member_status != 'accepted' THEN
    RAISE EXCEPTION 'not_accepted: only accepted members can leave a group (use decline for invitations)';
  END IF;

  -- The group lock held above means no concurrent activation/settlement/
  -- claim can commit a fresh balance for the caller between this check
  -- and the delete below.
  IF public.has_outstanding_balance(p_group_id, v_caller) THEN
    RAISE EXCEPTION 'has_outstanding_balance: you have unsettled debts in this group';
  END IF;

  DELETE FROM public.settlements
  WHERE group_id    = p_group_id
    AND status      = 'pending'
    AND (from_user_id = v_caller OR to_user_id = v_caller);

  DELETE FROM public.balances
  WHERE group_id = p_group_id
    AND (user_a = v_caller OR user_b = v_caller)
    AND amount_cents = 0;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;
END;
$$;

-- CREATE OR REPLACE preserves the existing EXECUTE grants; re-assert
-- them idempotently so both functions remain callable by authenticated
-- users.
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;
