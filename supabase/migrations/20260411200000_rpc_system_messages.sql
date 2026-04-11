-- Update activate_expense and record_and_settle to insert system messages
-- into chat_messages when the expense/settlement belongs to a DM group.
--
-- System messages appear in the DM conversation thread so both users can
-- see expenses and settlements inline with their chat history.

-- ============================================================
-- activate_expense — add system_expense message for DM groups
-- ============================================================

CREATE OR REPLACE FUNCTION activate_expense(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense          RECORD;
  v_total            integer;
  v_sum_shares       integer;
  v_sum_guest_shares integer;
  v_sum_payers       integer;
  v_is_dm            boolean;
  r_pair             RECORD;
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

  -- Sum registered user shares
  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_shares
    FROM expense_shares
   WHERE expense_id = p_expense_id;

  -- Sum guest shares
  SELECT COALESCE(SUM(share_amount_cents), 0)
    INTO v_sum_guest_shares
    FROM expense_guest_shares
   WHERE expense_id = p_expense_id;

  IF (v_sum_shares + v_sum_guest_shares) != v_total THEN
    RAISE EXCEPTION 'shares_mismatch: shares sum to % (users: %, guests: %), expected %',
      v_sum_shares + v_sum_guest_shares, v_sum_shares, v_sum_guest_shares, v_total;
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_sum_payers
    FROM expense_payers
   WHERE expense_id = p_expense_id;

  IF v_sum_payers != v_total THEN
    RAISE EXCEPTION 'payers_mismatch: payers sum to %, expected %', v_sum_payers, v_total;
  END IF;

  -- Compute balance deltas for registered users only.
  -- Guest shares don't create balance entries until claimed.
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

  -- Transition to active
  UPDATE expenses
     SET status = 'active'
   WHERE id = p_expense_id;

  -- Insert system message for DM groups
  SELECT is_dm INTO v_is_dm FROM groups WHERE id = v_expense.group_id;

  IF v_is_dm THEN
    INSERT INTO chat_messages (group_id, sender_id, message_type, content, expense_id)
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

-- ============================================================
-- record_and_settle — add system_settlement message for DM groups
-- ============================================================

CREATE OR REPLACE FUNCTION record_and_settle(
  p_group_id     uuid,
  p_from_user_id uuid,
  p_to_user_id   uuid,
  p_amount_cents integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_user_a  uuid;
  v_user_b  uuid;
  v_delta   integer;
  v_id      uuid;
  v_is_dm   boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_caller != p_from_user_id AND v_caller != p_to_user_id THEN
    RAISE EXCEPTION 'permission_denied: caller must be debtor or creditor';
  END IF;

  IF p_group_id NOT IN (SELECT my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member';
  END IF;

  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: must be positive';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'invalid_users: cannot settle with yourself';
  END IF;

  INSERT INTO settlements (group_id, from_user_id, to_user_id, amount_cents, status, confirmed_at)
  VALUES (p_group_id, p_from_user_id, p_to_user_id, p_amount_cents, 'confirmed', now())
  RETURNING id INTO v_id;

  IF p_from_user_id < p_to_user_id THEN
    v_user_a := p_from_user_id;
    v_user_b := p_to_user_id;
    v_delta  := -p_amount_cents;
  ELSE
    v_user_a := p_to_user_id;
    v_user_b := p_from_user_id;
    v_delta  := p_amount_cents;
  END IF;

  INSERT INTO balances (group_id, user_a, user_b, amount_cents)
  VALUES (p_group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = balances.amount_cents + EXCLUDED.amount_cents,
    updated_at   = now();

  -- Insert system message for DM groups
  SELECT is_dm INTO v_is_dm FROM groups WHERE id = p_group_id;

  IF v_is_dm THEN
    INSERT INTO chat_messages (group_id, sender_id, message_type, content, settlement_id)
    VALUES (
      p_group_id,
      v_caller,
      'system_settlement',
      '',
      v_id
    );
  END IF;

  RETURN v_id;
END;
$$;
