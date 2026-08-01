-- Issue #472 slice: enforce canonical two-person DM membership at the
-- guest-claim ingress.
--
-- claim_guest_spot is the only DM ingress that never consulted dm_pairs.
-- join_group_via_link already rejects DM targets defensively
-- (20260729100000_dm_canonical_pairs_invite_immutability_draft_authority.sql),
-- and group_members_insert RLS is regular-group-only, but this RPC is
-- SECURITY DEFINER and inserted group_members ... status='accepted' with
-- no pair check.
--
-- The immediate fix reuses the owner-only assert_dm_group_shape /
-- assert_dm_actor helpers already installed by 20260729100000. They run
-- under the group lifecycle lock and before any guest/claim-state read or
-- membership, share, allocation or balance write, mirroring
-- join_group_via_link's guard. For a DM group: PST07 for corrupt persisted
-- shape, PST05 for a non-pair caller; for a regular group assert_dm_actor
-- returns early and behavior is unchanged.
--
-- The function body is copied verbatim from the latest effective definition
-- (20260808000000_claim_guest_spot_zero_share_payer.sql); only the two-line
-- DM authorization guard is added after the group lifecycle lock.

CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id              uuid := auth.uid();
  v_guest_ref              RECORD;
  v_group                  RECORD;
  v_expense                RECORD;
  v_guest                  RECORD;
  v_guest_share            RECORD;
  v_existing               uuid;
  v_existing_share_amount  integer;
  v_guest_entity_idx       integer;
  v_pending_sum            integer := 0;
  r_edge                   RECORD;
  v_user_a                 uuid;
  v_user_b                 uuid;
  v_delta                  integer;
  v_token                  uuid;
  v_maintenance             boolean;
BEGIN
  -- #477/#495: "Run #477's financial compatibility guard as the first
  -- body action and require authentication." Shared lock first: see
  -- activate_saved_expense's identical comment (20260731000000).
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(477000001::bigint);

  SELECT maintenance INTO v_maintenance
    FROM financial_internal.financial_compatibility_state
   WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION 'financial_maintenance' USING ERRCODE = 'PST09';
  END IF;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  SELECT eg.id AS guest_id, eg.expense_id, e.group_id
    INTO v_guest_ref
    FROM public.expense_guests eg
    LEFT JOIN public.expenses e ON e.id = eg.expense_id
   WHERE eg.claim_token = p_claim_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: claim token not found';
  END IF;

  IF v_guest_ref.group_id IS NULL THEN
    RAISE EXCEPTION 'expense_not_found: associated expense does not exist';
  END IF;

  SELECT g.id
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_guest_ref.group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  -- #472: canonical DM authorization. Runs under the group lifecycle
  -- lock and before any guest/claim-state read or membership, share,
  -- allocation or balance write. Mirrors join_group_via_link's guard.
  PERFORM public.assert_dm_group_shape(v_group.id, false);
  PERFORM public.assert_dm_actor(v_group.id, v_caller_id);

  SELECT e.*
    INTO v_expense
    FROM public.expenses e
   WHERE e.id = v_guest_ref.expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: associated expense does not exist';
  END IF;

  IF v_expense.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  SELECT eg.*
    INTO v_guest
    FROM public.expense_guests eg
   WHERE eg.id = v_guest_ref.guest_id
     AND eg.claim_token = p_claim_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: claim token not found';
  END IF;

  IF v_guest.expense_id IS DISTINCT FROM v_expense.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  -- Already-claimed: idempotent for the same caller (zero writes, no
  -- token), denied for any other caller.
  IF v_guest.claimed_by IS NOT NULL THEN
    IF v_guest.claimed_by = v_caller_id THEN
      SELECT e.participant_index
        INTO v_guest_entity_idx
        FROM public.expense_allocation_entities e
       WHERE e.expense_id = v_guest.expense_id
         AND e.guest_id = v_guest.id;

      IF v_guest_entity_idx IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.expense_balance_allocations ea
         WHERE ea.expense_id = v_guest.expense_id
           AND ea.debtor_index = v_guest_entity_idx
           AND ea.applied_to_user_id IS DISTINCT FROM v_caller_id
      ) THEN
        RAISE EXCEPTION 'allocation_state_corrupt: pending guest edge not applied to caller'
          USING ERRCODE = 'PST07';
      END IF;

      RETURN jsonb_build_object(
        'guest_id', v_guest.id,
        'expense_id', v_guest.expense_id,
        'already_claimed', true
      );
    END IF;

    RAISE EXCEPTION 'already_claimed: this guest spot has been claimed by another user'
      USING ERRCODE = 'PST05';
  END IF;

  -- Check for existing user share.
  SELECT id, share_amount_cents
    INTO v_existing, v_existing_share_amount
    FROM public.expense_shares
   WHERE expense_id = v_guest.expense_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    -- #495: zero-share payer can claim by updating the zero share to
    -- the guest's share amount, instead of raising duplicate_participant.
    -- This preserves the #468-supported path in which a payer with no
    -- prior share claims a guest.
    IF v_existing_share_amount = 0 AND EXISTS (
      SELECT 1 FROM public.expense_payers ep
       WHERE ep.expense_id = v_guest.expense_id
         AND ep.user_id = v_caller_id
    ) THEN
      -- Fall through to the share transfer below; the existing zero
      -- share will be UPDATEd rather than INSERTed.
      NULL;
    ELSE
      RAISE EXCEPTION 'duplicate_participant: you already have a share on this expense';
    END IF;
  END IF;

  SELECT egs.*
    INTO v_guest_share
    FROM public.expense_guest_shares egs
   WHERE egs.guest_id = v_guest.id
     AND egs.expense_id = v_guest.expense_id
     FOR UPDATE;

  v_token := graph_internal.open_named_token(v_guest.expense_id, 'claim', v_expense.graph_revision, v_group.id);

  IF v_expense.status = 'active' THEN
    SELECT e.participant_index
      INTO v_guest_entity_idx
      FROM public.expense_allocation_entities e
     WHERE e.expense_id = v_guest.expense_id
       AND e.guest_id = v_guest.id;

    IF v_guest_entity_idx IS NOT NULL THEN
      SELECT COALESCE(SUM(ea.amount_cents), 0)
        INTO v_pending_sum
        FROM public.expense_balance_allocations ea
       WHERE ea.expense_id = v_guest.expense_id
         AND ea.debtor_index = v_guest_entity_idx
         AND ea.applied_to_user_id IS NULL;

      IF COALESCE(v_guest_share.share_amount_cents, 0) <> v_pending_sum THEN
        RAISE EXCEPTION 'allocation_state_corrupt: pending guest edges (%) != guest share (%)',
          v_pending_sum, COALESCE(v_guest_share.share_amount_cents, 0)
          USING ERRCODE = 'PST07';
      END IF;

      FOR r_edge IN
        SELECT ea.allocation_index,
               ea.amount_cents,
               c.user_id AS creditor_user
          FROM public.expense_balance_allocations ea
          JOIN public.expense_allocation_entities c
            ON c.expense_id = ea.expense_id
           AND c.participant_index = ea.creditor_index
         WHERE ea.expense_id = v_guest.expense_id
           AND ea.debtor_index = v_guest_entity_idx
           AND ea.applied_to_user_id IS NULL
         ORDER BY ea.allocation_index
      LOOP
        IF r_edge.creditor_user IS DISTINCT FROM v_caller_id THEN
          IF v_caller_id < r_edge.creditor_user THEN
            v_user_a := v_caller_id;
            v_user_b := r_edge.creditor_user;
            v_delta  := r_edge.amount_cents;
          ELSE
            v_user_a := r_edge.creditor_user;
            v_user_b := v_caller_id;
            v_delta  := -r_edge.amount_cents;
          END IF;

          INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
          VALUES (v_expense.group_id, v_user_a, v_user_b, v_delta)
          ON CONFLICT (group_id, user_a, user_b)
          DO UPDATE SET
            amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
            updated_at = now();
        END IF;

        UPDATE public.expense_balance_allocations
           SET applied_to_user_id = v_caller_id,
               applied_at = statement_timestamp()
         WHERE expense_id = v_guest.expense_id
           AND allocation_index = r_edge.allocation_index;
      END LOOP;
    END IF;
  END IF;

  IF v_guest_share IS NOT NULL THEN
    -- #495: If the claimant already has a zero share (the zero-share-payer
    -- exception above), UPDATE it to the guest's share amount instead of
    -- inserting a duplicate.
    IF v_existing IS NOT NULL THEN
      UPDATE public.expense_shares
         SET share_amount_cents = v_guest_share.share_amount_cents
       WHERE expense_id = v_guest.expense_id
         AND user_id = v_caller_id;
    ELSE
      INSERT INTO public.expense_shares (expense_id, user_id, share_amount_cents)
      VALUES (v_guest.expense_id, v_caller_id, v_guest_share.share_amount_cents);
    END IF;

    DELETE FROM public.expense_guest_shares
     WHERE guest_id = v_guest.id
       AND expense_id = v_guest.expense_id;
  END IF;

  UPDATE public.expense_guests
     SET claimed_by = v_caller_id,
         claimed_at = now()
   WHERE id = v_guest.id;

  INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_expense.group_id, v_caller_id, 'accepted', v_expense.creator_id, now())
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET status = 'accepted',
        accepted_at = COALESCE(public.group_members.accepted_at, now())
    WHERE public.group_members.status != 'accepted';

  -- #495 spec: "advance graph_revision exactly once from r to r + 1" for
  -- a real claim (this UPDATE never runs on the already-claimed/
  -- idempotent-replay return path above, which returns before this
  -- point) so authorized clients' revisioned snapshot refetch actually
  -- observes the claim. 'claim' is a named token (graph_internal.
  -- open_named_token), so unlike a 'direct' token its caller is allowed
  -- to bump graph_revision inline -- exactly like activate_saved_expense.
  UPDATE public.expenses
     SET updated_at = now(),
         graph_revision = graph_revision + 1
   WHERE id = v_guest.expense_id;

  PERFORM graph_internal.close_token(v_token);

  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'already_claimed', false
  );
END;
$$;

COMMENT ON FUNCTION public.claim_guest_spot(uuid) IS
  'Issue #495: claim a guest spot by token. Amended to allow a zero-share '
  'payer to claim by updating their zero share to the guest amount, instead '
  'of raising duplicate_participant. Nonpayers with zero shares, payers with '
  'positive shares, and payers from other expenses remain ineligible. '
  'Issue #472: enforces canonical DM authorization (assert_dm_group_shape + '
  'assert_dm_actor) under the group lock before any claim-state mutation.';
