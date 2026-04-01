-- Fix: when a user claims a guest spot but already has a group_members row
-- with status='invited' (from a handle-based invite), upgrade them to
-- 'accepted' instead of silently skipping (ON CONFLICT DO NOTHING).
-- Without this fix the user ends up with expense shares and balances they
-- cannot see because my_accepted_group_ids() excludes 'invited' rows.

CREATE OR REPLACE FUNCTION claim_guest_spot(p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest        RECORD;
  v_guest_share  RECORD;
  v_expense      RECORD;
  v_caller_id    uuid;
  v_existing     uuid;
  r_payer        RECORD;
  v_delta        integer;
  v_user_a       uuid;
  v_user_b       uuid;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'auth_required: must be authenticated';
  END IF;

  -- Lock and fetch guest row
  SELECT *
    INTO v_guest
    FROM expense_guests
   WHERE claim_token = p_claim_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: claim token not found';
  END IF;

  IF v_guest.claimed_by IS NOT NULL THEN
    -- If already claimed by this same user, return success idempotently
    IF v_guest.claimed_by = v_caller_id THEN
      RETURN jsonb_build_object(
        'guest_id', v_guest.id,
        'expense_id', v_guest.expense_id,
        'already_claimed', true
      );
    END IF;
    RAISE EXCEPTION 'already_claimed: this guest spot has been claimed by another user';
  END IF;

  -- Check if caller already has a share on this expense (prevent duplicates)
  SELECT id INTO v_existing
    FROM expense_shares
   WHERE expense_id = v_guest.expense_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    RAISE EXCEPTION 'duplicate_participant: you already have a share on this expense';
  END IF;

  -- Fetch expense details
  SELECT *
    INTO v_expense
    FROM expenses
   WHERE id = v_guest.expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: associated expense does not exist';
  END IF;

  -- Fetch guest share
  SELECT *
    INTO v_guest_share
    FROM expense_guest_shares
   WHERE guest_id = v_guest.id
     AND expense_id = v_guest.expense_id;

  -- Mark guest as claimed
  UPDATE expense_guests
     SET claimed_by = v_caller_id,
         claimed_at = now()
   WHERE id = v_guest.id;

  -- Add user to group if not already a member, or upgrade invited → accepted
  INSERT INTO group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_expense.group_id, v_caller_id, 'accepted', v_expense.creator_id, now())
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET status = 'accepted',
        accepted_at = COALESCE(group_members.accepted_at, now())
    WHERE group_members.status != 'accepted';

  -- If the guest had a share, create a real expense_share
  IF v_guest_share IS NOT NULL AND v_guest_share.share_amount_cents > 0 THEN
    INSERT INTO expense_shares (expense_id, user_id, share_amount_cents)
    VALUES (v_guest.expense_id, v_caller_id, v_guest_share.share_amount_cents);

    -- If expense is active, update balances for this new participant
    IF v_expense.status = 'active' AND v_expense.total_amount > 0 THEN
      -- For each payer, compute balance delta (same logic as activate_expense)
      FOR r_payer IN
        SELECT user_id, amount_cents
          FROM expense_payers
         WHERE expense_id = v_guest.expense_id
           AND user_id != v_caller_id
      LOOP
        v_delta := ROUND(
          v_guest_share.share_amount_cents::numeric
          * r_payer.amount_cents::numeric
          / v_expense.total_amount
        )::integer;

        IF v_delta != 0 THEN
          -- Canonical ordering
          IF v_caller_id < r_payer.user_id THEN
            v_user_a := v_caller_id;
            v_user_b := r_payer.user_id;
            -- caller (consumer) < payer → positive delta (caller owes payer)
          ELSE
            v_user_a := r_payer.user_id;
            v_user_b := v_caller_id;
            v_delta  := -v_delta;
            -- payer < caller (consumer) → negative delta
          END IF;

          INSERT INTO balances (group_id, user_a, user_b, amount_cents)
          VALUES (v_expense.group_id, v_user_a, v_user_b, v_delta)
          ON CONFLICT (group_id, user_a, user_b)
          DO UPDATE SET
            amount_cents = balances.amount_cents + EXCLUDED.amount_cents,
            updated_at   = now();
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Touch the parent expense so useRealtimeExpense fires on the inviter's screen
  UPDATE expenses SET updated_at = now() WHERE id = v_guest.expense_id;

  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'already_claimed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION claim_guest_spot(uuid) TO authenticated;
