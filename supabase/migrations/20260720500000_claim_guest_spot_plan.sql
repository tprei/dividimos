-- ============================================================
-- Issue #468: rewrite public.claim_guest_spot to apply the
-- guest's STORED pending allocation plan edges to the claimant.
--
-- This replaces the per-payer ROUND(guest_share * payer / total)
-- algorithm (#468's second bug): a one-cent guest share funded by
-- two one-cent payers yielded two one-cent debts, so the claimant
-- owed two cents for a one-cent share. The deterministic plan
-- builder (build_expense_allocation_plan_edges) instead stores a
-- SINGLE pending guest edge of one cent for that fixture, and the
-- claim now consumes those exact integer edges directly — no
-- per-payer cell, no ROUND on money.
--
-- Source of truth on an active expense: the pending
-- expense_balance_allocations rows whose debtor entity is the
-- guest (applied_to_user_id IS NULL). The claim:
--   - requires their sum to equal the guest share exactly (PST07),
--   - applies each edge as claimant(debtor) -> creditor(user) to
--     balances using the #468 sign convention, and
--   - marks every formerly pending guest edge applied to the
--     claimant.
--
-- Non-active expenses (draft/settled) have no plan edges; the
-- claim transfers the share without touching balances, exactly as
-- the previous body did. This preserves the existing claim
-- contract for draft expenses (a member retroactively joining a
-- not-yet-activated expense).
--
-- Signature and result shape are unchanged:
--   claim_guest_spot(p_claim_token uuid) RETURNS jsonb
--   {'guest_id','expense_id','already_claimed'}
-- The opaque-text-token cutover is owned by #581.
--
-- Forward-only: CREATE OR REPLACE of an existing function. No
-- table or column changes. Existing EXECUTE grants are preserved
-- by CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_guest_ref        RECORD;
  v_group            RECORD;
  v_expense          RECORD;
  v_guest            RECORD;
  v_guest_share      RECORD;
  v_existing         uuid;
  v_guest_entity_idx integer;
  v_pending_sum      integer := 0;
  r_edge             RECORD;
  v_user_a           uuid;
  v_user_b           uuid;
  v_delta            integer;
BEGIN
  -- --------------------------------------------------------------
  -- 1. Authenticated caller.
  -- --------------------------------------------------------------
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  -- --------------------------------------------------------------
  -- 2. Non-locking token lookup to discover guest/expense/group.
  -- --------------------------------------------------------------
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

  -- --------------------------------------------------------------
  -- 3. Lock hierarchy: group -> expense -> guest (re-check token).
  -- --------------------------------------------------------------
  SELECT g.id
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_guest_ref.group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

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

  -- --------------------------------------------------------------
  -- 4. Already-claimed: idempotent for the same caller, denied for
  --    any other caller. Verify the guest's plan edges are all
  --    applied to the caller (defensive; no writes).
  -- --------------------------------------------------------------
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

  -- --------------------------------------------------------------
  -- 5. Caller must not already participate in this expense.
  -- --------------------------------------------------------------
  SELECT id
    INTO v_existing
    FROM public.expense_shares
   WHERE expense_id = v_guest.expense_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    RAISE EXCEPTION 'duplicate_participant: you already have a share on this expense';
  END IF;

  -- --------------------------------------------------------------
  -- 6. Lock the guest share row.
  -- --------------------------------------------------------------
  SELECT egs.*
    INTO v_guest_share
    FROM public.expense_guest_shares egs
   WHERE egs.guest_id = v_guest.id
     AND egs.expense_id = v_guest.expense_id
     FOR UPDATE;

  -- --------------------------------------------------------------
  -- 7. Active expense: the stored pending plan edges are the exact
  --    source of truth. Require their sum to equal the guest share,
  --    then apply each edge (no per-payer ROUND, no division).
  -- --------------------------------------------------------------
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

      -- Pending edges must reproduce the guest share exactly. A
      -- zero-share guest has zero pending rows and zero sum.
      IF COALESCE(v_guest_share.share_amount_cents, 0) <> v_pending_sum THEN
        RAISE EXCEPTION 'allocation_state_corrupt: pending guest edges (%) != guest share (%)',
          v_pending_sum, COALESCE(v_guest_share.share_amount_cents, 0)
          USING ERRCODE = 'PST07';
      END IF;

      -- ----------------------------------------------------------
      -- 8. Apply each pending edge as claimant(debtor) ->
      --    creditor(user). #468 sign convention:
      --    balances(user_a, user_b).amount_cents > 0 means user_a
      --    owes user_b. A claimant who is also the creditor of an
      --    edge is self-canceling: no balance row, but the edge is
      --    still marked applied.
      -- ----------------------------------------------------------
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

        -- 9. The claimant takes over the guest's obligation.
        UPDATE public.expense_balance_allocations
           SET applied_to_user_id = v_caller_id,
               applied_at = statement_timestamp()
         WHERE expense_id = v_guest.expense_id
           AND allocation_index = r_edge.allocation_index;
      END LOOP;
    END IF;
  END IF;

  -- --------------------------------------------------------------
  -- 9. Transfer the share: claimant receives the guest's share
  --    amount, the guest share row is removed, the guest is marked
  --    claimed (one-shot null -> claimant/now).
  -- --------------------------------------------------------------
  IF v_guest_share IS NOT NULL THEN
    INSERT INTO public.expense_shares (expense_id, user_id, share_amount_cents)
    VALUES (v_guest.expense_id, v_caller_id, v_guest_share.share_amount_cents);

    DELETE FROM public.expense_guest_shares
     WHERE guest_id = v_guest.id
       AND expense_id = v_guest.expense_id;
  END IF;

  UPDATE public.expense_guests
     SET claimed_by = v_caller_id,
         claimed_at = now()
   WHERE id = v_guest.id;

  -- --------------------------------------------------------------
  -- 10. Membership: insert/upgrade under the group lock, after all
  --     checks. An already-accepted member is not touched.
  -- --------------------------------------------------------------
  INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_expense.group_id, v_caller_id, 'accepted', v_expense.creator_id, now())
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET status = 'accepted',
        accepted_at = COALESCE(public.group_members.accepted_at, now())
    WHERE public.group_members.status != 'accepted';

  UPDATE public.expenses
     SET updated_at = now()
   WHERE id = v_guest.expense_id;

  -- --------------------------------------------------------------
  -- 11. Success. Any exception above rolls back membership, the
  --     share transfer, balances, plan state and the claim state.
  -- --------------------------------------------------------------
  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'already_claimed', false
  );
END;
$$;

COMMENT ON FUNCTION public.claim_guest_spot(uuid) IS
  'Claim a guest spot for the calling user (#468). On an active '
  'expense, applies the guest''s stored pending allocation plan '
  'edges directly to balances (no per-payer ROUND); on a '
  'non-active expense, transfers the share without balances. '
  'Idempotent for the same caller; denied (PST05) for any other.';

-- CREATE OR REPLACE preserves the existing EXECUTE grant; re-assert
-- it idempotently so the function remains callable by authenticated
-- users.
GRANT EXECUTE ON FUNCTION public.claim_guest_spot(uuid) TO authenticated;
