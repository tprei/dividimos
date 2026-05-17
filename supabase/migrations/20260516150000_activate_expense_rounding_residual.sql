-- =============================================================
-- Fix: activate_expense rounding residual reconciliation
--
-- The previous implementation applied ROUND() to each individual
-- (expense_share × expense_payer) cell before summing into canonical
-- (user_a, user_b) pairs. With N contributing cells per pair the
-- accumulated error could reach ±N/2 cents, violating the invariant
-- that the sum of all balance deltas for an expense equals zero.
--
-- The fix:
--   1. Aggregate exact NUMERIC values per canonical pair first.
--   2. ROUND once at the pair level to produce integer cents.
--   3. Track the cumulative rounding residual across all pairs.
--   4. After the loop, if the residual is non-zero, subtract
--      ROUND(residual) from the deterministic first pair
--      (smallest (user_a, user_b) in lex order) to keep the
--      total-balance invariant exact.
--
-- Algorithm guarantees:
--   • Sum-of-pairs invariant exact: the sum of all rounded balance row
--     amount_cents exactly equals ROUND(sum of exact per-pair deltas).
--   • Per-pair error bounded ±1 cent: each rounded pair value differs
--     from its exact value by at most 1 cent (before residual correction).
--   • Per-user error bounded by their pair count: a user appearing in
--     K canonical pairs can accumulate up to ±K cents of error versus
--     their exact net. The residual correction lands on the single
--     lexicographically-first pair, so per-user accuracy is not exact
--     and is UUID-ordering-dependent.
--
-- New DECLARE variables (vs. the previous definition):
--   v_delta_exact    numeric  — exact (unrounded) delta for a pair
--   v_delta_rounded  integer  — ROUND(v_delta_exact)
--   v_total_residual numeric  — cumulative residual across all pairs
--   v_first_pair_a   uuid     — user_a of the deterministic first pair
--   v_first_pair_b   uuid     — user_b of the deterministic first pair
-- =============================================================

CREATE OR REPLACE FUNCTION public.activate_expense(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expense          RECORD;
  v_total            integer;
  v_sum_shares       integer;
  v_sum_guest_shares integer;
  v_sum_payers       integer;
  v_non_member       uuid;
  v_is_dm            boolean;
  r_pair             RECORD;
  v_delta_exact      numeric;
  v_delta_rounded    integer;
  v_total_residual   numeric := 0;
  v_first_pair_a     uuid;
  v_first_pair_b     uuid;
BEGIN
  SELECT *
    INTO v_expense
    FROM public.expenses
   WHERE id = p_expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: %', p_expense_id;
  END IF;

  IF v_expense.creator_id != auth.uid() THEN
    RAISE EXCEPTION 'permission_denied: only the creator can activate';
  END IF;

  IF v_expense.group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member';
  END IF;

  IF v_expense.status != 'draft' THEN
    RAISE EXCEPTION 'invalid_status: expense is %, expected draft', v_expense.status;
  END IF;

  v_total := v_expense.total_amount;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: total_amount must be positive';
  END IF;

  -- Every share.user_id must be a group member (any status) or the creator.
  SELECT s.user_id
    INTO v_non_member
    FROM public.expense_shares s
    WHERE s.expense_id = p_expense_id
      AND NOT EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = v_expense.group_id
          AND gm.user_id = s.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.id = v_expense.group_id
          AND g.creator_id = s.user_id
      )
    LIMIT 1;

  IF v_non_member IS NOT NULL THEN
    RAISE EXCEPTION 'non_member_share: user % is not a member of group %',
      v_non_member, v_expense.group_id;
  END IF;

  -- Same check for payers.
  SELECT p.user_id
    INTO v_non_member
    FROM public.expense_payers p
    WHERE p.expense_id = p_expense_id
      AND NOT EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = v_expense.group_id
          AND gm.user_id = p.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.id = v_expense.group_id
          AND g.creator_id = p.user_id
      )
    LIMIT 1;

  IF v_non_member IS NOT NULL THEN
    RAISE EXCEPTION 'non_member_payer: user % is not a member of group %',
      v_non_member, v_expense.group_id;
  END IF;

  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_shares
    FROM public.expense_shares
   WHERE expense_id = p_expense_id;

  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_guest_shares
    FROM public.expense_guest_shares
   WHERE expense_id = p_expense_id;

  IF (v_sum_shares + v_sum_guest_shares) != v_total THEN
    RAISE EXCEPTION 'shares_mismatch: shares sum to % (users: %, guests: %), expected %',
      v_sum_shares + v_sum_guest_shares, v_sum_shares, v_sum_guest_shares, v_total;
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_sum_payers
    FROM public.expense_payers
   WHERE expense_id = p_expense_id;

  IF v_sum_payers != v_total THEN
    RAISE EXCEPTION 'payers_mismatch: payers sum to %, expected %', v_sum_payers, v_total;
  END IF;

  FOR r_pair IN
    SELECT
      LEAST(s.user_id, p.user_id)    AS user_a,
      GREATEST(s.user_id, p.user_id) AS user_b,
      SUM(
        CASE
          WHEN s.user_id < p.user_id
            THEN  s.share_amount_cents::numeric * p.amount_cents::numeric / v_total
          WHEN s.user_id > p.user_id
            THEN -(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)
        END
      ) AS delta_exact
    FROM public.expense_shares s
    CROSS JOIN public.expense_payers p
    WHERE s.expense_id = p_expense_id
      AND p.expense_id = p_expense_id
      AND s.user_id != p.user_id
    GROUP BY LEAST(s.user_id, p.user_id), GREATEST(s.user_id, p.user_id)
    ORDER BY LEAST(s.user_id, p.user_id), GREATEST(s.user_id, p.user_id)
  LOOP
    v_delta_exact   := r_pair.delta_exact;
    v_delta_rounded := ROUND(v_delta_exact)::integer;
    v_total_residual := v_total_residual + (v_delta_rounded::numeric - v_delta_exact);

    IF v_first_pair_a IS NULL THEN
      v_first_pair_a := r_pair.user_a;
      v_first_pair_b := r_pair.user_b;
    END IF;

    IF v_delta_rounded != 0 THEN
      INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
      VALUES (v_expense.group_id, r_pair.user_a, r_pair.user_b, v_delta_rounded)
      ON CONFLICT (group_id, user_a, user_b)
      DO UPDATE SET
        amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
        updated_at   = now();
    END IF;
  END LOOP;

  IF v_total_residual != 0 AND v_first_pair_a IS NOT NULL THEN
    INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
    VALUES (v_expense.group_id, v_first_pair_a, v_first_pair_b, -(ROUND(v_total_residual)::integer))
    ON CONFLICT (group_id, user_a, user_b)
    DO UPDATE SET
      amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
      updated_at   = now();
  END IF;

  UPDATE public.expenses
     SET status = 'active'
   WHERE id = p_expense_id;

  SELECT is_dm INTO v_is_dm FROM public.groups WHERE id = v_expense.group_id;

  IF v_is_dm THEN
    INSERT INTO public.chat_messages (group_id, sender_id, message_type, content, expense_id)
    VALUES (
      v_expense.group_id,
      v_expense.creator_id,
      'system_expense',
      '',
      p_expense_id
    );
  END IF;
END;
$$;
