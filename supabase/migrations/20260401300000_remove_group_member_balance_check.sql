-- Guard against removing group members with outstanding balances.
--
-- Adds:
-- 1. has_outstanding_balance(group_id, user_id) — helper that returns TRUE
--    when the user has any non-zero balance row in the group.
-- 2. remove_group_member(group_id, user_id) — SECURITY DEFINER RPC that
--    checks for outstanding balances before deleting the membership row.
--    Raises 'has_outstanding_balance' if the user still owes or is owed money.
-- 3. Tightens the RLS DELETE policy on group_members so that only the RPC
--    (running as SECURITY DEFINER) can perform the delete. Direct client
--    DELETEs by the creator are no longer allowed — they must go through
--    the RPC which enforces the balance check.

-- ============================================================
-- 1. Helper: does a user have any non-zero balance in a group?
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_outstanding_balance(
  p_group_id uuid,
  p_user_id  uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.balances
    WHERE group_id = p_group_id
      AND (user_a = p_user_id OR user_b = p_user_id)
      AND amount_cents != 0
  );
$$;

-- ============================================================
-- 2. RPC: remove a member from a group (with balance guard)
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

  -- Only the group creator can remove members
  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

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

  -- Block removal if the user has outstanding balances
  IF public.has_outstanding_balance(p_group_id, p_user_id) THEN
    RAISE EXCEPTION 'has_outstanding_balance: member has unsettled debts in this group';
  END IF;

  -- All checks passed — delete the membership row
  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

-- Grant authenticated users access to the RPC
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_outstanding_balance(uuid, uuid) TO authenticated;

-- ============================================================
-- 3. Tighten the DELETE policy on group_members
-- ============================================================
-- The old "group_members_delete" policy allowed the creator to delete
-- any member directly. Replace it with a policy that only allows
-- deletion by the SECURITY DEFINER RPC (which runs as the function owner,
-- not as the calling user). This forces all removals through the balance
-- check.
--
-- We keep the self-decline policy unchanged — invited users can still
-- decline their own invitation (no balance possible for invited members).

DROP POLICY IF EXISTS "group_members_delete" ON public.group_members;

-- The RPC runs as SECURITY DEFINER (superuser context), so it bypasses
-- RLS entirely. For regular authenticated users, we block direct DELETE
-- by making the policy impossible to satisfy (false). The self-decline
-- policy remains as a separate policy for invited users.
CREATE POLICY "group_members_delete" ON public.group_members
  FOR DELETE USING (false);
