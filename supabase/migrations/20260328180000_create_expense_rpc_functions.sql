-- RPC functions for atomically updating balances when expenses are
-- activated or settlements are confirmed.
--
-- These run as SECURITY DEFINER so they can write to the `balances`
-- table, which has no INSERT/UPDATE RLS policies for regular users.

-- ============================================================
-- activate_expense(p_expense_id uuid)
-- ============================================================
-- Transitions an expense from 'draft' → 'active' and atomically
-- updates the balances table for every (consumer, payer) pair.
--
-- Balance delta per canonical pair (user_a < user_b):
--   For each (consumer C, payer P) where C ≠ P:
--     debt = ROUND(C.share * P.payment / total)
--     if C < P → positive delta (user_a owes user_b)
--     if C > P → negative delta (user_b owes user_a)
--
-- Must be called by the expense creator. Raises on invalid state.

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
  -- Lock the expense row to prevent concurrent activation
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

  IF v_expense.status != 'draft' THEN
    RAISE EXCEPTION 'invalid_status: expense is %, expected draft', v_expense.status;
  END IF;

  v_total := v_expense.total_amount;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: total_amount must be positive';
  END IF;

  -- Validate shares exist and sum correctly
  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_shares
    FROM expense_shares
   WHERE expense_id = p_expense_id;

  IF v_sum_shares != v_total THEN
    RAISE EXCEPTION 'shares_mismatch: shares sum to %, expected %', v_sum_shares, v_total;
  END IF;

  -- Validate payers exist and sum correctly
  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_sum_payers
    FROM expense_payers
   WHERE expense_id = p_expense_id;

  IF v_sum_payers != v_total THEN
    RAISE EXCEPTION 'payers_mismatch: payers sum to %, expected %', v_sum_payers, v_total;
  END IF;

  -- Compute balance deltas for each canonical (user_a, user_b) pair
  -- and upsert into the balances table.
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
          -- s.user_id = p.user_id is excluded by WHERE
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

  -- Transition to active
  UPDATE expenses
     SET status = 'active'
   WHERE id = p_expense_id;
END;
$$;

-- ============================================================
-- confirm_settlement(p_settlement_id uuid)
-- ============================================================
-- Confirms a pending settlement and updates the balances table.
--
-- The settlement records that from_user paid to_user some amount.
-- from_user is the debtor, to_user is the creditor.
--
-- Balance convention: positive amount_cents = user_a owes user_b.
--
-- Must be called by to_user (the creditor/payee). Raises on
-- invalid state.

CREATE OR REPLACE FUNCTION confirm_settlement(p_settlement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement RECORD;
  v_user_a     uuid;
  v_user_b     uuid;
  v_delta      integer;
BEGIN
  -- Lock the settlement row
  SELECT *
    INTO v_settlement
    FROM settlements
   WHERE id = p_settlement_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found: %', p_settlement_id;
  END IF;

  IF v_settlement.to_user_id != auth.uid() THEN
    RAISE EXCEPTION 'permission_denied: only the payee can confirm';
  END IF;

  IF v_settlement.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status: settlement is %, expected pending', v_settlement.status;
  END IF;

  -- Determine canonical pair ordering and delta direction.
  -- from_user is paying to_user (from owes to, reducing debt).
  IF v_settlement.from_user_id < v_settlement.to_user_id THEN
    -- user_a = from, user_b = to
    -- Positive balance = user_a owes user_b. Payment reduces it.
    v_user_a := v_settlement.from_user_id;
    v_user_b := v_settlement.to_user_id;
    v_delta  := -v_settlement.amount_cents;
  ELSE
    -- user_a = to, user_b = from
    -- Positive balance = user_a(to) owes user_b(from).
    -- But from owes to → user_b owes user_a → represented as negative.
    -- Payment moves balance toward zero (more positive).
    v_user_a := v_settlement.to_user_id;
    v_user_b := v_settlement.from_user_id;
    v_delta  := v_settlement.amount_cents;
  END IF;

  -- Upsert balance
  INSERT INTO balances (group_id, user_a, user_b, amount_cents)
  VALUES (v_settlement.group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = balances.amount_cents + EXCLUDED.amount_cents,
    updated_at   = now();

  -- Mark confirmed
  UPDATE settlements
     SET status       = 'confirmed',
         confirmed_at = now()
   WHERE id = p_settlement_id;
END;
$$;

-- ============================================================
-- GRANTS
-- ============================================================
-- Allow authenticated users to call these functions via RPC.

GRANT EXECUTE ON FUNCTION activate_expense(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_settlement(uuid) TO authenticated;
