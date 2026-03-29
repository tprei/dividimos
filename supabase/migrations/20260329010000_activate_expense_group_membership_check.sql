-- Add group membership check to activate_expense.
--
-- The original function only verified creator_id == auth.uid() but did not
-- check whether the caller is a member of the expense's group. Since the
-- function runs as SECURITY DEFINER, RLS is bypassed, so a non-member
-- creator could activate an expense in a group they don't belong to.
--
-- This matches the guard already present in record_and_settle.

CREATE OR REPLACE FUNCTION activate_expense(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense   RECORD;
  v_total     integer;
  v_sum_shares integer;
  v_sum_payers integer;
  r_pair      RECORD;
BEGIN
  SELECT *
    INTO v_expense
    FROM expenses
   WHERE id = p_expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: %', p_expense_id;
  END IF;

  IF v_expense.creator_id != auth.uid() THEN
    RAISE EXCEPTION 'permission_denied: only the creator can activate';
  END IF;

  IF v_expense.group_id NOT IN (SELECT my_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member';
  END IF;

  IF v_expense.status != 'draft' THEN
    RAISE EXCEPTION 'invalid_status: expense is %, expected draft', v_expense.status;
  END IF;

  v_total := v_expense.total_amount;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: total_amount must be positive';
  END IF;

  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_shares
    FROM expense_shares
   WHERE expense_id = p_expense_id;

  IF v_sum_shares != v_total THEN
    RAISE EXCEPTION 'shares_mismatch: shares sum to %, expected %', v_sum_shares, v_total;
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_sum_payers
    FROM expense_payers
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
            THEN  ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
          WHEN s.user_id > p.user_id
            THEN -ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
        END
      ) AS delta
    FROM expense_shares s
    CROSS JOIN expense_payers p
    WHERE s.expense_id = p_expense_id
      AND p.expense_id = p_expense_id
      AND s.user_id != p.user_id
    GROUP BY LEAST(s.user_id, p.user_id), GREATEST(s.user_id, p.user_id)
    HAVING SUM(
      CASE
        WHEN s.user_id < p.user_id
          THEN  ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
        WHEN s.user_id > p.user_id
          THEN -ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
      END
    ) != 0
  LOOP
    INSERT INTO balances (group_id, user_a, user_b, amount_cents)
    VALUES (v_expense.group_id, r_pair.user_a, r_pair.user_b, r_pair.delta)
    ON CONFLICT (group_id, user_a, user_b)
    DO UPDATE SET
      amount_cents = balances.amount_cents + EXCLUDED.amount_cents,
      updated_at   = now();
  END LOOP;

  UPDATE expenses
     SET status = 'active'
   WHERE id = p_expense_id;
END;
$$;
