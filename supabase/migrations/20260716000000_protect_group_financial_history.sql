DO $$
DECLARE
  v_relation text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.payments',
    'public.item_splits',
    'public.bill_splits',
    'public.bill_payers',
    'public.bill_participants',
    'public.bill_items',
    'public.ledger',
    'public.group_settlements',
    'public.bills'
  ] LOOP
    IF pg_catalog.to_regclass(v_relation) IS NOT NULL THEN
      RAISE EXCEPTION 'legacy relation remains: %', v_relation;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('public.sync_group_settlements(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.sync_group_settlements(uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy sync_group_settlements function remains';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "group_delete" ON public.groups;
DROP POLICY IF EXISTS group_delete_denied ON public.groups;
CREATE POLICY group_delete_denied
  ON public.groups
  FOR DELETE TO authenticated
  USING (false);

REVOKE DELETE ON TABLE public.groups FROM PUBLIC, anon, authenticated;
GRANT DELETE ON TABLE public.groups TO service_role;

DROP POLICY IF EXISTS "expenses_delete" ON public.expenses;
CREATE POLICY "expenses_delete" ON public.expenses
  FOR DELETE TO authenticated
  USING (
    creator_id = auth.uid()
    AND status = 'draft'
    AND group_id IN (SELECT public.my_accepted_group_ids())
  );

CREATE OR REPLACE FUNCTION public.delete_group(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_group  RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  SELECT id, creator_id, is_dm
    INTO v_group
    FROM public.groups
   WHERE id = p_group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'PST05';
  END IF;

  IF v_group.creator_id IS DISTINCT FROM v_caller OR v_group.is_dm THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'PST05';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.expenses
     WHERE group_id = p_group_id
  ) OR EXISTS (
    SELECT 1
      FROM public.balances
     WHERE group_id = p_group_id
       AND amount_cents <> 0
  ) OR EXISTS (
    SELECT 1
      FROM public.settlements
     WHERE group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  DELETE FROM public.groups
   WHERE id = p_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_group(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_expense(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller          uuid := auth.uid();
  v_group_id        uuid;
  v_group            RECORD;
  v_expense          RECORD;
  v_total            integer;
  v_sum_shares       integer;
  v_sum_guest_shares integer;
  v_sum_payers       integer;
  v_non_member       uuid;
  r_pair             RECORD;
  v_delta_exact      numeric;
  v_delta_rounded    integer;
  v_total_residual   numeric := 0;
  v_first_pair_a     uuid;
  v_first_pair_b     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  SELECT e.group_id
    INTO v_group_id
    FROM public.expenses e
   WHERE e.id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: %', p_expense_id;
  END IF;

  SELECT g.id, g.creator_id, g.is_dm
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

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

  IF v_expense.creator_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'permission_denied: only the creator can activate' USING ERRCODE = 'PST05';
  END IF;

  IF v_expense.group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member' USING ERRCODE = 'PST05';
  END IF;

  IF v_expense.status != 'draft' THEN
    RAISE EXCEPTION 'invalid_status: expense is %, expected draft', v_expense.status;
  END IF;

  v_total := v_expense.total_amount;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: total_amount must be positive';
  END IF;

  SELECT s.user_id
    INTO v_non_member
    FROM public.expense_shares s
   WHERE s.expense_id = p_expense_id
     AND NOT EXISTS (
       SELECT 1
         FROM public.group_members gm
        WHERE gm.group_id = v_expense.group_id
          AND gm.user_id = s.user_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.groups g
        WHERE g.id = v_expense.group_id
          AND g.creator_id = s.user_id
     )
   LIMIT 1;

  IF v_non_member IS NOT NULL THEN
    RAISE EXCEPTION 'non_member_share: user % is not a member of group %',
      v_non_member, v_expense.group_id;
  END IF;

  SELECT p.user_id
    INTO v_non_member
    FROM public.expense_payers p
   WHERE p.expense_id = p_expense_id
     AND NOT EXISTS (
       SELECT 1
         FROM public.group_members gm
        WHERE gm.group_id = v_expense.group_id
          AND gm.user_id = p.user_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.groups g
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
      LEAST(s.user_id, p.user_id) AS user_a,
      GREATEST(s.user_id, p.user_id) AS user_b,
      SUM(
        CASE
          WHEN s.user_id < p.user_id
            THEN s.share_amount_cents::numeric * p.amount_cents::numeric / v_total
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
    v_delta_exact := r_pair.delta_exact;
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
        updated_at = now();
    END IF;
  END LOOP;

  IF v_total_residual != 0
     AND ROUND(v_total_residual)::integer != 0
     AND v_first_pair_a IS NOT NULL THEN
    INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
    VALUES (
      v_expense.group_id,
      v_first_pair_a,
      v_first_pair_b,
      -(ROUND(v_total_residual)::integer)
    )
    ON CONFLICT (group_id, user_a, user_b)
    DO UPDATE SET
      amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
      updated_at = now();
  END IF;

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
END;
$$;

CREATE OR REPLACE FUNCTION public.record_and_settle(
  p_group_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount_cents integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_group        RECORD;
  v_counterparty uuid;
  v_user_a       uuid;
  v_user_b       uuid;
  v_delta        integer;
  v_id           uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  SELECT g.id, g.creator_id, g.is_dm
    INTO v_group
    FROM public.groups g
   WHERE g.id = p_group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  IF v_caller != p_from_user_id AND v_caller != p_to_user_id THEN
    RAISE EXCEPTION 'permission_denied: caller must be debtor or creditor' USING ERRCODE = 'PST05';
  END IF;

  IF p_group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member' USING ERRCODE = 'PST05';
  END IF;

  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: must be positive';
  END IF;

  IF p_amount_cents > 10000000 THEN
    RAISE EXCEPTION 'invalid_amount: exceeds maximum of R$100.000,00';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'invalid_users: cannot settle with yourself';
  END IF;

  v_counterparty := CASE
    WHEN v_caller = p_from_user_id THEN p_to_user_id
    ELSE p_from_user_id
  END;

  IF NOT EXISTS (
    SELECT 1
      FROM public.group_members
     WHERE group_id = p_group_id
       AND user_id = v_counterparty
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.groups
     WHERE id = p_group_id
       AND creator_id = v_counterparty
  ) THEN
    RAISE EXCEPTION 'permission_denied: counterparty is not a group member' USING ERRCODE = 'PST05';
  END IF;

  INSERT INTO public.settlements (
    group_id,
    from_user_id,
    to_user_id,
    amount_cents,
    status,
    confirmed_at
  )
  VALUES (p_group_id, p_from_user_id, p_to_user_id, p_amount_cents, 'confirmed', now())
  RETURNING id INTO v_id;

  IF p_from_user_id < p_to_user_id THEN
    v_user_a := p_from_user_id;
    v_user_b := p_to_user_id;
    v_delta := -p_amount_cents;
  ELSE
    v_user_a := p_to_user_id;
    v_user_b := p_from_user_id;
    v_delta := p_amount_cents;
  END IF;

  INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
  VALUES (p_group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
    updated_at = now();

  IF v_group.is_dm THEN
    INSERT INTO public.chat_messages (group_id, sender_id, message_type, content, settlement_id)
    VALUES (p_group_id, v_caller, 'system_settlement', '', v_id);
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_settlement(p_settlement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_group_id    uuid;
  v_group       RECORD;
  v_settlement  RECORD;
  v_user_a      uuid;
  v_user_b      uuid;
  v_delta       integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  SELECT s.group_id
    INTO v_group_id
    FROM public.settlements s
   WHERE s.id = p_settlement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found: %', p_settlement_id;
  END IF;

  SELECT g.id
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  SELECT s.*
    INTO v_settlement
    FROM public.settlements s
   WHERE s.id = p_settlement_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_not_found: %', p_settlement_id;
  END IF;

  IF v_settlement.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  IF v_settlement.to_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'permission_denied: only the payee can confirm' USING ERRCODE = 'PST05';
  END IF;

  IF v_settlement.group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: caller is no longer a member of the group' USING ERRCODE = 'PST05';
  END IF;

  IF v_settlement.status != 'pending' THEN
    RAISE EXCEPTION 'invalid_status: settlement is %, expected pending', v_settlement.status;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.group_members
     WHERE group_id = v_settlement.group_id
       AND user_id = v_settlement.from_user_id
       AND status = 'accepted'
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.groups
     WHERE id = v_settlement.group_id
       AND creator_id = v_settlement.from_user_id
  ) THEN
    RAISE EXCEPTION 'permission_denied: debtor is no longer a member of the group' USING ERRCODE = 'PST05';
  END IF;

  IF v_settlement.from_user_id < v_settlement.to_user_id THEN
    v_user_a := v_settlement.from_user_id;
    v_user_b := v_settlement.to_user_id;
    v_delta := -v_settlement.amount_cents;
  ELSE
    v_user_a := v_settlement.to_user_id;
    v_user_b := v_settlement.from_user_id;
    v_delta := v_settlement.amount_cents;
  END IF;

  INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
  VALUES (v_settlement.group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
    updated_at = now();

  UPDATE public.settlements
     SET status = 'confirmed',
         confirmed_at = now()
   WHERE id = p_settlement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_guest_ref   RECORD;
  v_group       RECORD;
  v_expense     RECORD;
  v_guest       RECORD;
  v_guest_share RECORD;
  v_existing    uuid;
  r_payer       RECORD;
  v_delta       integer;
  v_user_a      uuid;
  v_user_b      uuid;
BEGIN
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

  SELECT id
    INTO v_existing
    FROM public.expense_shares
   WHERE expense_id = v_guest.expense_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    RAISE EXCEPTION 'duplicate_participant: you already have a share on this expense';
  END IF;

  SELECT egs.*
    INTO v_guest_share
    FROM public.expense_guest_shares egs
   WHERE egs.guest_id = v_guest.id
     AND egs.expense_id = v_guest.expense_id;

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
            v_delta := -v_delta;
          END IF;

          INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
          VALUES (v_expense.group_id, v_user_a, v_user_b, v_delta)
          ON CONFLICT (group_id, user_a, user_b)
          DO UPDATE SET
            amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
            updated_at = now();
        END IF;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.expenses
     SET updated_at = now()
   WHERE id = v_guest.expense_id;

  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'already_claimed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.join_group_via_link(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id  uuid := auth.uid();
  v_link_ref   RECORD;
  v_group      RECORD;
  v_link       RECORD;
  v_existing   RECORD;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  SELECT l.id, l.group_id
    INTO v_link_ref
    FROM public.group_invite_links l
   WHERE l.token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: invite link not found';
  END IF;

  SELECT g.id
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_link_ref.group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  SELECT l.*
    INTO v_link
    FROM public.group_invite_links l
   WHERE l.id = v_link_ref.id
     AND l.token = p_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: invite link not found';
  END IF;

  IF v_link.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  IF NOT v_link.is_active THEN
    RAISE EXCEPTION 'link_inactive: this invite link has been deactivated';
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
    RAISE EXCEPTION 'link_expired: this invite link has expired';
  END IF;

  IF v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN
    RAISE EXCEPTION 'link_exhausted: this invite link has reached its maximum uses';
  END IF;

  SELECT group_id, user_id, status
    INTO v_existing
    FROM public.group_members
   WHERE group_id = v_link.group_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    IF v_existing.status = 'accepted' THEN
      RETURN jsonb_build_object(
        'group_id', v_link.group_id,
        'already_member', true,
        'status', 'accepted'
      );
    END IF;

    UPDATE public.group_members
       SET status = 'accepted',
           accepted_at = now()
     WHERE group_id = v_link.group_id
       AND user_id = v_caller_id;

    UPDATE public.group_invite_links
       SET use_count = use_count + 1
     WHERE id = v_link.id;

    RETURN jsonb_build_object(
      'group_id', v_link.group_id,
      'already_member', false,
      'status', 'accepted'
    );
  END IF;

  INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_link.group_id, v_caller_id, 'accepted', v_link.created_by, now());

  UPDATE public.group_invite_links
     SET use_count = use_count + 1
   WHERE id = v_link.id;

  RETURN jsonb_build_object(
    'group_id', v_link.group_id,
    'already_member', false,
    'status', 'accepted'
  );
END;
$$;
