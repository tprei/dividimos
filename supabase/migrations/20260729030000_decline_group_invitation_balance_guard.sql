-- ============================================================
-- Issue #499: prevent an invited member's decline from orphaning a
-- posted balance.
--
-- An invited (not-yet-accepted) member can already accrue a real,
-- posted balance: activate_expense allows expense_shares/expense_payers
-- for any group_members status, not just 'accepted'. Declining today is
-- a raw client-side DELETE gated only by an RLS policy that checks
-- status = 'invited' — it performs zero balance validation, so a normal
-- decline can delete the only membership row referencing a user who has
-- a nonzero balance, stranding an unsettleable, unviewable financial
-- edge (the remaining party can no longer settle with an outsider; see
-- 20260413000000_security_audit_fixes.sql's membership requirement on
-- confirm_settlement/record_settlements).
--
-- Product rule chosen (per the issue's explicit either/or): fail
-- atomically and retain the invitation, matching the identical
-- established pattern in remove_group_member/leave_group — neither of
-- which auto-reconciles a balance either. This covers both the invited
-- debtor and invited creditor case symmetrically, because the balance
-- check below inspects both sides of the balances row.
--
-- Fix: public.decline_group_invitation(p_group_id uuid) — SECURITY
-- DEFINER RPC that locks the group row FOR UPDATE (joining the same
-- lock hierarchy as every other balance-producing/membership RPC),
-- verifies the caller is currently invited, blocks the decline if the
-- caller has a nonzero balance in the group, and otherwise deletes the
-- membership row (plus any now-orphanable pending settlement/
-- zero-balance rows referencing the caller, matching leave_group's own
-- defensive cleanup). The old direct-DELETE self-decline policy is
-- locked to false, forcing every decline through this guarded path.
--
-- Forward-only: new function, no table or column changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.decline_group_invitation(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_member_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock the group row (the root of the lock hierarchy) before any
  -- balance check or membership mutation, matching activate_expense,
  -- claim_guest_spot, confirm_settlement, record_settlements,
  -- delete_group, leave_group, and remove_group_member.
  PERFORM id FROM public.groups WHERE id = p_group_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  SELECT status INTO v_member_status
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: you are not invited to this group';
  END IF;

  IF v_member_status != 'invited' THEN
    RAISE EXCEPTION 'not_invited: only a pending invitation can be declined (use leave for an accepted membership)';
  END IF;

  -- Block the decline if the invited user has an outstanding balance in
  -- either direction (debtor or creditor). The group lock held above
  -- means no concurrent activation/settlement/claim can commit a fresh
  -- balance for the caller between this check and the delete below.
  --
  -- Deliberately NOT calling public.has_outstanding_balance(group_id,
  -- user_id): that shared helper's own body additionally requires
  -- auth.uid() (the CALLER) to already be an accepted member of the
  -- group (my_accepted_group_ids()) before it will check anyone's
  -- balance at all. That assumption holds for remove_group_member
  -- (caller is the creator) and leave_group (caller is the leaver, but
  -- leave_group already requires accepted status before reaching this
  -- check) — it does not hold here, where the caller is precisely the
  -- not-yet-accepted invitee checking their own balance. The query
  -- below is has_outstanding_balance's exact body, inlined.
  IF EXISTS (
    SELECT 1
      FROM public.balances
     WHERE group_id = p_group_id
       AND (user_a = v_caller OR user_b = v_caller)
       AND amount_cents != 0
  ) THEN
    RAISE EXCEPTION 'has_outstanding_balance: you have an unsettled balance in this group; ask the group to settle with you before declining';
  END IF;

  -- Defensive cleanup mirroring leave_group: an invited member should
  -- not normally have pending settlements, but remove them (and any
  -- zero-balance rows) rather than leave them referencing a departed
  -- nonmember.
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

GRANT EXECUTE ON FUNCTION public.decline_group_invitation(uuid) TO authenticated;

-- Lock down the old direct-DELETE self-decline path. Every decline must
-- now go through the guarded RPC above, exactly like remove_group_member
-- already forced direct group_members DELETE through its own RPC.
DROP POLICY IF EXISTS "group_members_self_decline" ON public.group_members;

CREATE POLICY "group_members_self_decline_denied" ON public.group_members
  FOR DELETE USING (false);
