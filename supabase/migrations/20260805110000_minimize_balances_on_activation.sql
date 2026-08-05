-- Normalize the balance ledger when an expense is activated (issue #592).
--
-- A sequence of activations can itself build a cross-chain or cycle that a
-- later simplified settlement would then mishandle. Running
-- minimize_group_balances at the end of activate_expense keeps the stored
-- balances canonical at all times, so the chain never persists to be settled
-- inconsistently.
--
-- Forward-only redefinition of public.activate_expense(uuid): the body is
-- copied verbatim from 20260720400000_activate_expense_allocation_plan.sql
-- with one addition: minimize_group_balances(v_group_id) runs after the
-- active-status flip and the DM system message, before the single RETURN.
-- CREATE OR REPLACE preserves the existing ACL; the EXECUTE grant revoked by
-- 20260731000000 is intentionally NOT re-asserted here.

CREATE OR REPLACE FUNCTION public.activate_expense(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller           uuid := auth.uid();
  v_group_id         uuid;
  v_group            RECORD;
  v_expense          RECORD;
  v_total            integer;
  v_sum_shares       integer;
  v_sum_guest_shares integer;
  v_sum_payers       integer;
  v_non_member       uuid;
  v_entity_count     integer;
  v_edge_count       integer;
  v_total_debt       integer;
  v_source_digest    text;
  r_edge             RECORD;
  v_user_a           uuid;
  v_user_b           uuid;
  v_delta            integer;
BEGIN
  -- --------------------------------------------------------------
  -- 1. Authenticated caller.
  -- --------------------------------------------------------------
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  -- --------------------------------------------------------------
  -- 2. Non-locking lookup of the expense's group_id.
  -- --------------------------------------------------------------
  SELECT e.group_id
    INTO v_group_id
    FROM public.expenses e
   WHERE e.id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: %', p_expense_id;
  END IF;

  -- --------------------------------------------------------------
  -- 3. Lock the group row (the root of the lock hierarchy).
  -- --------------------------------------------------------------
  SELECT g.id, g.creator_id, g.is_dm
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  -- --------------------------------------------------------------
  -- 4. Lock the expense row; group must match.
  -- --------------------------------------------------------------
  SELECT e.*
    INTO v_expense
    FROM public.expenses e
   WHERE e.id = p_expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: %', p_expense_id;
  END IF;

  IF v_expense.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  -- --------------------------------------------------------------
  -- 5. Creator + accepted-membership guards.
  -- --------------------------------------------------------------
  IF v_expense.creator_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'permission_denied: only the creator can activate' USING ERRCODE = 'PST05';
  END IF;

  IF v_expense.group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member' USING ERRCODE = 'PST05';
  END IF;

  -- --------------------------------------------------------------
  -- 6. Status must be draft; total must be positive.
  -- --------------------------------------------------------------
  IF v_expense.status != 'draft' THEN
    RAISE EXCEPTION 'invalid_status: expense is %, expected draft', v_expense.status;
  END IF;

  v_total := v_expense.total_amount;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: total_amount must be positive' USING ERRCODE = 'PST03';
  END IF;

  -- --------------------------------------------------------------
  -- 7. Exact invariant checks. Lock children before validating.
  -- --------------------------------------------------------------
  PERFORM 1 FROM public.expense_shares      WHERE expense_id = p_expense_id FOR UPDATE;
  PERFORM 1 FROM public.expense_payers      WHERE expense_id = p_expense_id FOR UPDATE;
  PERFORM 1 FROM public.expense_guest_shares WHERE expense_id = p_expense_id FOR UPDATE;
  PERFORM 1 FROM public.expense_guests      WHERE expense_id = p_expense_id FOR UPDATE;

  -- Every share user is a current group member or the group creator.
  SELECT s.user_id
    INTO v_non_member
    FROM public.expense_shares s
   WHERE s.expense_id = p_expense_id
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = v_expense.group_id AND gm.user_id = s.user_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.groups g
        WHERE g.id = v_expense.group_id AND g.creator_id = s.user_id
     )
   LIMIT 1;

  IF v_non_member IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_amount: non_member_share: user % is not a member of group %',
      v_non_member, v_expense.group_id USING ERRCODE = 'PST03';
  END IF;

  -- Every payer user is a current group member or the group creator.
  SELECT p.user_id
    INTO v_non_member
    FROM public.expense_payers p
   WHERE p.expense_id = p_expense_id
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = v_expense.group_id AND gm.user_id = p.user_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.groups g
        WHERE g.id = v_expense.group_id AND g.creator_id = p.user_id
     )
   LIMIT 1;

  IF v_non_member IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_amount: non_member_payer: user % is not a member of group %',
      v_non_member, v_expense.group_id USING ERRCODE = 'PST03';
  END IF;

  -- No claimed guest may still have an unconverted guest share.
  IF EXISTS (
    SELECT 1
      FROM public.expense_guest_shares gs
      JOIN public.expense_guests g ON g.id = gs.guest_id
     WHERE gs.expense_id = p_expense_id
       AND g.claimed_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid_amount: claimed_guest_share_remains' USING ERRCODE = 'PST03';
  END IF;

  -- shares + guest_shares == total, exactly.
  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_shares
    FROM public.expense_shares
   WHERE expense_id = p_expense_id;

  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_guest_shares
    FROM public.expense_guest_shares
   WHERE expense_id = p_expense_id;

  IF (v_sum_shares + v_sum_guest_shares) != v_total THEN
    RAISE EXCEPTION 'invalid_amount: shares_mismatch: shares sum to % (users: %, guests: %), expected %',
      v_sum_shares + v_sum_guest_shares, v_sum_shares, v_sum_guest_shares, v_total
      USING ERRCODE = 'PST03';
  END IF;

  -- payers == total, exactly.
  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_sum_payers
    FROM public.expense_payers
   WHERE expense_id = p_expense_id;

  IF v_sum_payers != v_total THEN
    RAISE EXCEPTION 'invalid_amount: payers_mismatch: payers sum to %, expected %',
      v_sum_payers, v_total USING ERRCODE = 'PST03';
  END IF;

  -- --------------------------------------------------------------
  -- 8. Build the deterministic participant map. Order: share users
  --    by user_id, then payer-only users by user_id, then guests by
  --    guest_id. 1-based contiguous participant_index. Guests never
  --    pay (payer_amount_cents = 0).
  -- --------------------------------------------------------------
  DELETE FROM public.expense_allocation_entities WHERE expense_id = p_expense_id;

  WITH ranked AS (
    -- Share users: share from expense_shares, payer coalesced.
    SELECT
      'user'::text                    AS entity_kind,
      s.user_id                       AS uid,
      NULL::uuid                      AS gid,
      s.share_amount_cents            AS share_amount_cents,
      COALESCE((
        SELECT pp.amount_cents
          FROM public.expense_payers pp
         WHERE pp.expense_id = p_expense_id AND pp.user_id = s.user_id
      ), 0)                           AS payer_amount_cents,
      1                               AS sort_group,
      s.user_id                       AS sort_key
      FROM public.expense_shares s
     WHERE s.expense_id = p_expense_id
    UNION ALL
    -- Payer-only users (payer but not in shares): share 0.
    SELECT
      'user'::text,
      p.user_id,
      NULL::uuid,
      0,
      p.amount_cents,
      2,
      p.user_id
      FROM public.expense_payers p
     WHERE p.expense_id = p_expense_id
       AND NOT EXISTS (
         SELECT 1 FROM public.expense_shares s
          WHERE s.expense_id = p_expense_id AND s.user_id = p.user_id
       )
    UNION ALL
    -- Guests: share from expense_guest_shares, never pay.
    SELECT
      'guest'::text,
      NULL::uuid,
      gs.guest_id,
      gs.share_amount_cents,
      0,
      3,
      gs.guest_id
      FROM public.expense_guest_shares gs
     WHERE gs.expense_id = p_expense_id
  )
  INSERT INTO public.expense_allocation_entities
    (expense_id, participant_index, entity_kind, user_id, guest_id,
     share_amount_cents, payer_amount_cents, net_amount_cents)
  SELECT
    p_expense_id,
    row_number() OVER (ORDER BY sort_group, sort_key)::integer,
    entity_kind,
    uid,
    gid,
    share_amount_cents,
    payer_amount_cents,
    share_amount_cents - payer_amount_cents
    FROM ranked;

  SELECT count(*) INTO v_entity_count
    FROM public.expense_allocation_entities
   WHERE expense_id = p_expense_id;

  -- --------------------------------------------------------------
  -- 9. No pre-existing plan header (this is a draft activation).
  -- --------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM public.expense_balance_allocation_plans
     WHERE expense_id = p_expense_id
  ) THEN
    RAISE EXCEPTION 'allocation_state_corrupt: plan already exists for expense %',
      p_expense_id USING ERRCODE = 'PST07';
  END IF;

  -- Defensive: a guest can never have negative net (guests never pay).
  IF EXISTS (
    SELECT 1 FROM public.expense_allocation_entities
     WHERE expense_id = p_expense_id
       AND entity_kind = 'guest'
       AND net_amount_cents < 0
  ) THEN
    RAISE EXCEPTION 'allocation_state_corrupt: guest with negative net' USING ERRCODE = 'PST07';
  END IF;

  -- --------------------------------------------------------------
  -- 10. source_digest — internal drift check over the entity snapshot.
  -- --------------------------------------------------------------
  SELECT md5(string_agg(
      p_expense_id::text || ':' || participant_index || ':' || entity_kind || ':' ||
      COALESCE(user_id::text, '') || ':' || COALESCE(guest_id::text, '') || ':' ||
      share_amount_cents || ':' || payer_amount_cents || ':' || net_amount_cents,
      ',' ORDER BY participant_index
    ))
    INTO v_source_digest
    FROM public.expense_allocation_entities
   WHERE expense_id = p_expense_id;

  -- --------------------------------------------------------------
  -- 11. Build edges and validate exact incidence before any write.
  --     Materialize once (STABLE function; entities are locked and
  --     unchanged for the rest of this transaction).
  -- --------------------------------------------------------------
  CREATE TEMP TABLE tmp_activate_edges ON COMMIT DROP AS
    SELECT allocation_index, debtor_index, creditor_index, amount_cents
      FROM public.build_expense_allocation_plan_edges(p_expense_id);

  -- Contiguous allocation_index starting at 1.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT allocation_index,
             row_number() OVER (ORDER BY allocation_index)::integer AS expected_index
        FROM pg_temp.tmp_activate_edges
    ) x
     WHERE allocation_index <> expected_index
  ) THEN
    RAISE EXCEPTION 'allocation_state_corrupt: non-contiguous allocation_index'
      USING ERRCODE = 'PST07';
  END IF;

  -- Every edge: positive amount, debtor != creditor.
  IF EXISTS (
    SELECT 1 FROM pg_temp.tmp_activate_edges
     WHERE amount_cents <= 0 OR debtor_index = creditor_index
  ) THEN
    RAISE EXCEPTION 'allocation_state_corrupt: invalid edge (amount or self-loop)'
      USING ERRCODE = 'PST07';
  END IF;

  -- Guests are never creditors (guests never pay → net >= 0 → debtor only).
  IF EXISTS (
    SELECT 1
      FROM pg_temp.tmp_activate_edges ea
      JOIN public.expense_allocation_entities c
        ON c.expense_id = p_expense_id AND c.participant_index = ea.creditor_index
     WHERE c.entity_kind = 'guest'
  ) THEN
    RAISE EXCEPTION 'allocation_state_corrupt: guest is a creditor'
      USING ERRCODE = 'PST07';
  END IF;

  -- Per-entity incidence (outgoing - incoming) == net for every entity.
  -- Zero-net entities must have no edges touching them.
  IF EXISTS (
    WITH flows AS (
      SELECT debtor_index AS idx, amount_cents AS out_amt, 0 AS in_amt
        FROM pg_temp.tmp_activate_edges
      UNION ALL
      SELECT creditor_index, 0, amount_cents
        FROM pg_temp.tmp_activate_edges
    ),
    incidence AS (
      SELECT idx, COALESCE(SUM(out_amt), 0) - COALESCE(SUM(in_amt), 0) AS net_flow
        FROM flows
       GROUP BY idx
    )
    SELECT 1
      FROM public.expense_allocation_entities e
      LEFT JOIN incidence i ON i.idx = e.participant_index
     WHERE e.expense_id = p_expense_id
       AND COALESCE(i.net_flow, 0) <> e.net_amount_cents
  ) THEN
    RAISE EXCEPTION 'allocation_state_corrupt: incidence != net'
      USING ERRCODE = 'PST07';
  END IF;

  -- Total positive debt == total credit (== sum of edge amounts).
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_debt
    FROM pg_temp.tmp_activate_edges;

  IF v_total_debt <> (
    SELECT COALESCE(SUM(net_amount_cents), 0)
      FROM public.expense_allocation_entities
     WHERE expense_id = p_expense_id AND net_amount_cents > 0
  ) THEN
    RAISE EXCEPTION 'allocation_state_corrupt: total debt != total credit'
      USING ERRCODE = 'PST07';
  END IF;

  SELECT count(*) INTO v_edge_count FROM pg_temp.tmp_activate_edges;

  -- --------------------------------------------------------------
  -- 12. Insert the immutable plan header.
  -- --------------------------------------------------------------
  INSERT INTO public.expense_balance_allocation_plans
    (expense_id, algorithm_version, total_cents, entity_count, edge_count, source_digest)
  VALUES (p_expense_id, 1, v_total, v_entity_count, v_edge_count, v_source_digest);

  -- --------------------------------------------------------------
  -- 13. Insert the edges. User-debtor edges are applied at activation;
  --     guest-debtor edges stay pending (applied at claim).
  -- --------------------------------------------------------------
  INSERT INTO public.expense_balance_allocations
    (expense_id, allocation_index, debtor_index, creditor_index,
     amount_cents, applied_to_user_id, applied_at)
  SELECT
    p_expense_id,
    ea.allocation_index,
    ea.debtor_index,
    ea.creditor_index,
    ea.amount_cents,
    CASE WHEN d.entity_kind = 'user' THEN d.user_id ELSE NULL END,
    CASE WHEN d.entity_kind = 'user' THEN statement_timestamp() ELSE NULL END
    FROM pg_temp.tmp_activate_edges ea
    JOIN public.expense_allocation_entities d
      ON d.expense_id = p_expense_id AND d.participant_index = ea.debtor_index;

  -- --------------------------------------------------------------
  -- 14. Apply user-debtor edges to balances.
  --     #468 sign convention: positive amount_cents in
  --     balances(user_a, user_b) == user_a owes user_b.
  --     debtor pays creditor: if debtor < creditor, +amount on
  --     (debtor, creditor); else -amount on (creditor, debtor).
  -- --------------------------------------------------------------
  FOR r_edge IN
    SELECT d.user_id AS debtor_user,
           c.user_id AS creditor_user,
           ea.amount_cents
      FROM pg_temp.tmp_activate_edges ea
      JOIN public.expense_allocation_entities d
        ON d.expense_id = p_expense_id AND d.participant_index = ea.debtor_index
       AND d.entity_kind = 'user'
      JOIN public.expense_allocation_entities c
        ON c.expense_id = p_expense_id AND c.participant_index = ea.creditor_index
     ORDER BY ea.allocation_index
  LOOP
    -- Skip self-edges (a user who is both debtor and creditor cancels).
    IF r_edge.debtor_user IS DISTINCT FROM r_edge.creditor_user THEN
      IF r_edge.debtor_user < r_edge.creditor_user THEN
        v_user_a := r_edge.debtor_user;
        v_user_b := r_edge.creditor_user;
        v_delta  := r_edge.amount_cents;
      ELSE
        v_user_a := r_edge.creditor_user;
        v_user_b := r_edge.debtor_user;
        v_delta  := -r_edge.amount_cents;
      END IF;

      INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
      VALUES (v_expense.group_id, v_user_a, v_user_b, v_delta)
      ON CONFLICT (group_id, user_a, user_b)
      DO UPDATE SET
        amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
        updated_at = now();
    END IF;
  END LOOP;

  -- --------------------------------------------------------------
  -- 15. Transition the expense to active.
  -- --------------------------------------------------------------
  UPDATE public.expenses
     SET status = 'active'
   WHERE id = p_expense_id;

  IF v_group.is_dm THEN
    INSERT INTO public.chat_messages (group_id, sender_id, message_type, content, expense_id)
    VALUES (
      v_expense.group_id,
      v_expense.creator_id,
      'system_expense',
      '',
      p_expense_id
    );
  END IF;

  -- --------------------------------------------------------------
  -- 16. Any exception above rolls back entities, plan, edges,
  --     balances and the status flip together (single transaction).
  -- --------------------------------------------------------------
  -- Rewrite the group balances to the canonical minimal transfer set.
  PERFORM public.minimize_group_balances(v_group_id);
  RETURN;
END;
$$;
