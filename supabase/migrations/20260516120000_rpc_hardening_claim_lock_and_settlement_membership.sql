-- RPC hardening: S3 + S4
--
-- S3: claim_guest_spot acquires FOR UPDATE on public.expenses after locking
--     public.expense_guests, closing the race window against activate_expense.
-- S4: confirm_settlement rejects callers who have been removed from the
--     settlement's group between creation and confirmation.
--
-- Supersedes the relevant function bodies in 20260412010000_rls_hardening.sql.

-- ============================================================
-- S3. claim_guest_spot — add FOR UPDATE on expenses row
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  SELECT *
    INTO v_guest
    FROM public.expense_guests
   WHERE claim_token = p_claim_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: claim token not found';
  END IF;

  IF v_guest.claimed_by IS NOT NULL THEN
    IF v_guest.claimed_by = v_caller_id THEN
      RETURN jsonb_build_object(
        'guest_id', v_guest.id,
        'expense_id', v_guest.expense_id,
        'already_claimed', true
      );
    END IF;
    RAISE EXCEPTION 'already_claimed: this guest spot has been claimed by another user';
  END IF;

  SELECT id INTO v_existing
    FROM public.expense_shares
   WHERE expense_id = v_guest.expense_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    RAISE EXCEPTION 'duplicate_participant: you already have a share on this expense';
  END IF;

  SELECT * INTO v_expense FROM public.expenses WHERE id = v_guest.expense_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: associated expense does not exist';
  END IF;

  SELECT *
    INTO v_guest_share
    FROM public.expense_guest_shares
   WHERE guest_id = v_guest.id
     AND expense_id = v_guest.expense_id;

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

  IF v_guest_share IS NOT NULL AND v_guest_share.share_amount_cents > 0 THEN
    INSERT INTO public.expense_shares (expense_id, user_id, share_amount_cents)
    VALUES (v_guest.expense_id, v_caller_id, v_guest_share.share_amount_cents);

    IF v_expense.status = 'active' AND v_expense.total_amount > 0 THEN
      FOR r_payer IN
        SELECT user_id, amount_cents
          FROM public.expense_payers
         WHERE expense_id = v_guest.expense_id
           AND user_id != v_caller_id
      LOOP
        v_delta := ROUND(
          v_guest_share.share_amount_cents::numeric
          * r_payer.amount_cents::numeric
          / v_expense.total_amount
        )::integer;

        IF v_delta != 0 THEN
          IF v_caller_id < r_payer.user_id THEN
            v_user_a := v_caller_id;
            v_user_b := r_payer.user_id;
          ELSE
            v_user_a := r_payer.user_id;
            v_user_b := v_caller_id;
            v_delta  := -v_delta;
          END IF;

          INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
          VALUES (v_expense.group_id, v_user_a, v_user_b, v_delta)
          ON CONFLICT (group_id, user_a, user_b)
          DO UPDATE SET
            amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
            updated_at   = now();
        END IF;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.expenses SET updated_at = now() WHERE id = v_guest.expense_id;

  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'already_claimed', false
  );
END;
$$;

-- ============================================================
-- S4. confirm_settlement — membership gate
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_settlement(p_settlement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settlement RECORD;
  v_user_a     uuid;
  v_user_b     uuid;
  v_delta      integer;
BEGIN
  SELECT *
    INTO v_settlement
    FROM public.settlements
   WHERE id = p_settlement_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found: %', p_settlement_id;
  END IF;

  IF v_settlement.to_user_id != auth.uid() THEN
    RAISE EXCEPTION 'permission_denied: only the payee can confirm';
  END IF;

  IF v_settlement.group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: caller is no longer a member of the group';
  END IF;

  IF v_settlement.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status: settlement is %, expected pending', v_settlement.status;
  END IF;

  IF v_settlement.from_user_id < v_settlement.to_user_id THEN
    v_user_a := v_settlement.from_user_id;
    v_user_b := v_settlement.to_user_id;
    v_delta  := -v_settlement.amount_cents;
  ELSE
    v_user_a := v_settlement.to_user_id;
    v_user_b := v_settlement.from_user_id;
    v_delta  := v_settlement.amount_cents;
  END IF;

  INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
  VALUES (v_settlement.group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
    updated_at   = now();

  UPDATE public.settlements
     SET status       = 'confirmed',
         confirmed_at = now()
   WHERE id = p_settlement_id;
END;
$$;
