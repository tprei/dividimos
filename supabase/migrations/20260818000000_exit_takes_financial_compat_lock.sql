-- Migration: exit RPCs take the #477 financial-compatibility gate
--
-- leave_group and remove_group_member were the only membership-mutating,
-- balance-touching RPCs that did NOT take the shared #477 advisory lock +
-- maintenance-flag check that every balance writer takes
-- (confirm_settlement, claim_guest_spot, record_settlements,
-- activate_saved_expense, save_expense_draft_graph). An exit could therefore
-- proceed while financial maintenance mode was active. (#505 residual gap;
-- the original check-then-delete race was already closed by the groups
-- FOR UPDATE these functions already take.)
--
-- The gate is placed first in the body — before authentication — exactly as
-- confirm_settlement (20260816000000) and save_expense_draft_graph
-- (20260802000000) place it, so maintenance is enforced before any other
-- check and the function blocks (shared lock) on an active maintenance
-- session. Nothing else in either body changes.

CREATE OR REPLACE FUNCTION public.leave_group(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller         uuid := auth.uid();
  v_group_creator  uuid;
  v_member_status  text;
  v_draft_ids      uuid[];
  v_maintenance    boolean;
BEGIN
  -- #477/#495: financial-compatibility gate first (shared lock + maintenance
  -- flag), matching confirm_settlement / save_expense_draft_graph.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(477000001::bigint);

  SELECT maintenance INTO v_maintenance
    FROM financial_internal.financial_compatibility_state
   WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION 'financial_maintenance' USING ERRCODE = 'PST09';
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

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

  SELECT array_agg(id) INTO v_draft_ids
    FROM (
      SELECT id
        FROM public.expenses
       WHERE group_id = p_group_id AND creator_id = v_caller AND status = 'draft'
       ORDER BY id
       FOR UPDATE
    ) locked_drafts;

  IF v_draft_ids IS NOT NULL THEN
    PERFORM public.begin_expense_graph_direct_mutation(v_draft_ids);
    UPDATE public.expense_graph_save_operations
       SET outcome = 'retired',
           canonical_request = null,
           request_digest = null,
           expense_id = null,
           graph_revision = null,
           result = null,
           result_created_at = null,
           retired_reason = 'expense_deleted',
           retired_at = statement_timestamp()
     WHERE expense_id = ANY(v_draft_ids) AND outcome = 'committed';
    DELETE FROM public.expenses WHERE id = ANY(v_draft_ids);
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;
END;
$$;

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
  v_caller         uuid := auth.uid();
  v_group_creator  uuid;
  v_draft_ids      uuid[];
  v_maintenance    boolean;
BEGIN
  -- #477/#495: financial-compatibility gate first (shared lock + maintenance
  -- flag), matching confirm_settlement / save_expense_draft_graph.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(477000001::bigint);

  SELECT maintenance INTO v_maintenance
    FROM financial_internal.financial_compatibility_state
   WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION 'financial_maintenance' USING ERRCODE = 'PST09';
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  IF v_caller != v_group_creator THEN
    RAISE EXCEPTION 'permission_denied: only the group creator can remove members';
  END IF;

  IF p_user_id = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: cannot remove the group creator';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'member_not_found: user is not a member of this group';
  END IF;

  IF public.has_outstanding_balance(p_group_id, p_user_id) THEN
    RAISE EXCEPTION 'has_outstanding_balance: member has unsettled debts in this group';
  END IF;

  SELECT array_agg(id) INTO v_draft_ids
    FROM (
      SELECT id
        FROM public.expenses
       WHERE group_id = p_group_id AND creator_id = p_user_id AND status = 'draft'
       ORDER BY id
       FOR UPDATE
    ) locked_drafts;

  IF v_draft_ids IS NOT NULL THEN
    PERFORM public.begin_expense_graph_direct_mutation(v_draft_ids);
    UPDATE public.expense_graph_save_operations
       SET outcome = 'retired',
           canonical_request = null,
           request_digest = null,
           expense_id = null,
           graph_revision = null,
           result = null,
           result_created_at = null,
           retired_reason = 'expense_deleted',
           retired_at = statement_timestamp()
     WHERE expense_id = ANY(v_draft_ids) AND outcome = 'committed';
    DELETE FROM public.expenses WHERE id = ANY(v_draft_ids);
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;
