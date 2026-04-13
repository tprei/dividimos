-- RLS hardening pass.
--
-- Reconciled with the post-DM-invite-wall schema (2026-04-12). Every
-- SECURITY DEFINER function that writes ledger-affecting state is
-- normalized to search_path = '' with fully qualified table references,
-- and the authorization checks are tightened to validate both the
-- caller and the counterparty wherever both sides of a balance
-- transition are accepted via parameters rather than derived from
-- auth.uid() alone.
--
-- Findings addressed:
--
-- [CRITICAL] group_invite_links.SELECT was USING(true), letting any
--   authenticated user enumerate every invite token and join arbitrary
--   groups via join_group_via_link.
--
-- [CRITICAL] activate_expense did not validate that the users referenced
--   by expense_shares / expense_payers were members of the group at
--   all. A creator could fabricate balance rows for arbitrary user
--   UUIDs, corrupting the group ledger. The fix requires every share
--   and payer user to exist in group_members (invited or accepted) or
--   be the group creator — the adhoc-bill flow that adds invited
--   members to an expense still works.
--
-- [CRITICAL] record_and_settle only validated that the caller was an
--   accepted member; the counterparty was accepted at face value. An
--   accepted member could write phantom balances against strangers.
--   The fix requires the counterparty to be an existing group member
--   (invited or accepted) or the creator.
--
-- [HIGH] The DM invite wall lived only inside get_or_create_dm_group.
--   A client could INSERT a row into groups with is_dm = true
--   directly, bypassing the wall entirely. The fix blocks is_dm=true
--   from client INSERTs; the RPC (SECURITY DEFINER) still works.
--
-- [HIGH] chat_messages_insert used my_group_ids() so an invited (not
--   yet accepted) user could write back into a DM thread they had not
--   consented to. Tightened to my_accepted_group_ids(). SELECT stays
--   broad so the invite preview UI still renders from the server.
--
-- [MEDIUM] has_outstanding_balance was callable by any authenticated
--   user with arbitrary (group_id, user_id) parameters, leaking
--   balance existence across tenancies. Now requires the caller to
--   be an accepted member of the group.
--
-- [MEDIUM] expenses_update permitted the creator to flip
--   status = 'active' directly, bypassing the activate_expense RPC
--   and leaving the expense active without balance updates. Tightened
--   to draft-only updates.
--
-- [LOW] activate_expense, confirm_settlement, record_and_settle,
--   claim_guest_spot, join_group_via_link, and has_outstanding_balance
--   now all use SET search_path = '' with fully qualified names.
--
-- [LOW] activate_expense creator membership check upgraded from
--   my_group_ids() to my_accepted_group_ids().
--
-- [LOW] sync_group_settlements(uuid, jsonb) — an orphan definition
--   referencing the dropped group_settlements table — is dropped.

-- ============================================================
-- 1. group_invite_links SELECT — restrict to members / creators
-- ============================================================
-- The /join/[token] page uses the admin client (service role) to
-- look up link metadata before the user is a member, so it bypasses
-- RLS. Regular authenticated queries only come from group members
-- managing their own links.

DROP POLICY IF EXISTS "group_invite_links_select" ON public.group_invite_links;

CREATE POLICY "group_invite_links_select" ON public.group_invite_links
  FOR SELECT TO authenticated
  USING (
    group_id IN (SELECT public.my_accepted_group_ids())
    OR created_by = auth.uid()
  );

-- ============================================================
-- 2. groups INSERT — block direct creation of DM groups
-- ============================================================
-- DM groups must be created exclusively through get_or_create_dm_group
-- so the invite wall semantics stay in one place. The RPC runs as
-- SECURITY DEFINER and bypasses this policy.

DROP POLICY IF EXISTS "group_insert" ON public.groups;

CREATE POLICY "group_insert" ON public.groups
  FOR INSERT TO authenticated
  WITH CHECK (
    creator_id = auth.uid()
    AND is_dm = false
  );

-- ============================================================
-- 3. chat_messages INSERT — accepted members only
-- ============================================================
-- Previously used my_group_ids() which includes invited rows. An
-- invited DM recipient could write back into a thread they had not
-- accepted. SELECT stays broad so the invite wall preview can still
-- display the first message to the invited user if/when the UI
-- decides to render one — that decision lives in client code.
-- System messages (system_expense, system_settlement) come in via
-- SECURITY DEFINER RPCs, so they bypass this policy.

DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;

CREATE POLICY "chat_messages_insert" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND group_id IN (SELECT public.my_accepted_group_ids())
  );

-- ============================================================
-- 4. expenses UPDATE — creator can edit drafts only
-- ============================================================
-- A creator could previously flip status to 'active' via direct
-- UPDATE, skipping balance writes. Lock updates to draft rows.
-- activate_expense (SECURITY DEFINER) still transitions draft → active.

DROP POLICY IF EXISTS "expenses_update" ON public.expenses;

CREATE POLICY "expenses_update" ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    creator_id = auth.uid()
    AND group_id IN (SELECT public.my_accepted_group_ids())
    AND status = 'draft'
  )
  WITH CHECK (
    creator_id = auth.uid()
    AND status = 'draft'
  );

-- ============================================================
-- 5. has_outstanding_balance — add caller membership guard
-- ============================================================
-- Previously any authenticated user could probe any (group, user)
-- pair. Now requires the caller to be an accepted member of the
-- group. Called internally by remove_group_member and leave_group
-- (both SECURITY DEFINER, so auth.uid() is the original caller —
-- still a group member).

CREATE OR REPLACE FUNCTION public.has_outstanding_balance(
  p_group_id uuid,
  p_user_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.balances
    WHERE group_id = p_group_id
      AND (user_a = p_user_id OR user_b = p_user_id)
      AND amount_cents != 0
  );
END;
$$;

-- ============================================================
-- 6. record_and_settle — counterparty check + search_path fix
-- ============================================================
-- Counterparty must be a member of the group (invited or accepted)
-- or the group creator. Invited members are allowed because the
-- adhoc-bill flow creates balances against them before they accept.
-- Preserves the DM system_settlement side effect.

CREATE OR REPLACE FUNCTION public.record_and_settle(
  p_group_id     uuid,
  p_from_user_id uuid,
  p_to_user_id   uuid,
  p_amount_cents integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_counterparty uuid;
  v_user_a       uuid;
  v_user_b       uuid;
  v_delta        integer;
  v_id           uuid;
  v_is_dm        boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF v_caller != p_from_user_id AND v_caller != p_to_user_id THEN
    RAISE EXCEPTION 'permission_denied: caller must be debtor or creditor';
  END IF;

  IF p_group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
    RAISE EXCEPTION 'permission_denied: not a group member';
  END IF;

  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: must be positive';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION 'invalid_users: cannot settle with yourself';
  END IF;

  v_counterparty := CASE
    WHEN v_caller = p_from_user_id THEN p_to_user_id
    ELSE p_from_user_id
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = v_counterparty
  ) AND NOT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = p_group_id
      AND creator_id = v_counterparty
  ) THEN
    RAISE EXCEPTION 'permission_denied: counterparty is not a group member';
  END IF;

  INSERT INTO public.settlements (group_id, from_user_id, to_user_id, amount_cents, status, confirmed_at)
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

  INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
  VALUES (p_group_id, v_user_a, v_user_b, v_delta)
  ON CONFLICT (group_id, user_a, user_b)
  DO UPDATE SET
    amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
    updated_at   = now();

  SELECT is_dm INTO v_is_dm FROM public.groups WHERE id = p_group_id;

  IF v_is_dm THEN
    INSERT INTO public.chat_messages (group_id, sender_id, message_type, content, settlement_id)
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

-- ============================================================
-- 7. activate_expense — validate share/payer membership
-- ============================================================
-- A creator could otherwise fabricate balance rows for arbitrary
-- user UUIDs by inserting expense_shares / expense_payers with
-- non-member user_ids and then calling activate_expense. Every
-- referenced user must exist in group_members (invited or accepted)
-- or be the group creator. Invited is allowed to preserve the
-- adhoc-bill flow where a creator adds someone by handle before
-- they accept. Preserves the DM system_expense side effect.

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
            THEN  ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
          WHEN s.user_id > p.user_id
            THEN -ROUND(s.share_amount_cents::numeric * p.amount_cents::numeric / v_total)::integer
        END
      ) AS delta
    FROM public.expense_shares s
    CROSS JOIN public.expense_payers p
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
    INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
    VALUES (v_expense.group_id, r_pair.user_a, r_pair.user_b, r_pair.delta)
    ON CONFLICT (group_id, user_a, user_b)
    DO UPDATE SET
      amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
      updated_at   = now();
  END LOOP;

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

-- ============================================================
-- 8. confirm_settlement — search_path fix
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

-- ============================================================
-- 9. claim_guest_spot — search_path fix
-- ============================================================
-- Members claiming guest spots is a product feature (a group member
-- retroactively joins an expense they were not originally listed on),
-- so the function is NOT restricted to strangers. Only the search_path
-- hardening and schema prefixes change here.

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

  SELECT *
    INTO v_expense
    FROM public.expenses
   WHERE id = v_guest.expense_id;

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
-- 10. join_group_via_link — search_path fix
-- ============================================================

CREATE OR REPLACE FUNCTION public.join_group_via_link(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link       RECORD;
  v_caller_id  uuid;
  v_existing   RECORD;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'auth_required: must be authenticated';
  END IF;

  SELECT *
    INTO v_link
    FROM public.group_invite_links
   WHERE token = p_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: invite link not found';
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

-- ============================================================
-- 11. Drop orphan sync_group_settlements(uuid, jsonb)
-- ============================================================

DROP FUNCTION IF EXISTS public.sync_group_settlements(uuid, jsonb) CASCADE;
