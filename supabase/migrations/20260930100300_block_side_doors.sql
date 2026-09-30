-- the group creator's block now closes every join path: a stale invitation,
-- another member's invite link, or a guest slot on another member's expense
-- previously only checked the inviter/link creator/expense creator, so a user
-- blocked by the creator could still join and read the creator's messages.
-- record_settlement gains the same contact guard on its fresh-insert path
-- (idempotent replays of pre-existing settlements stay reachable), and
-- create_expense_with_group validates the expense payload before create_group's
-- per-member contact checks, so an invalid payload fails for every member id
-- instead of answering which ids blocked the caller.
CREATE OR REPLACE FUNCTION public.accept_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
  v_invited_by uuid;
  v_creator uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = p_group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  PERFORM public.assert_user_contact_allowed(v_actor, v_invited_by);

  SELECT creator_id INTO v_creator FROM public.groups WHERE id = p_group_id;
  PERFORM public.assert_user_contact_allowed(v_actor, v_creator);

  UPDATE group_members
  SET status = 'accepted', accepted_at = now()
  WHERE group_id = p_group_id AND user_id = v_actor;

  -- Shared-history latch: joining a group whose facts already exist makes
  -- them shared from this moment.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = p_group_id
    AND financial_history_shared_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.expenses WHERE group_id = p_group_id)
         OR EXISTS (SELECT 1 FROM public.settlements WHERE group_id = p_group_id));

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
  IF v_invited_by IS NOT NULL THEN
    PERFORM broadcast_user(v_invited_by, p_group_id);
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_via_link(p_token text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_link RECORD;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
  v_creator uuid;
BEGIN
  v_actor := current_user_id();

  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  SELECT * INTO v_link FROM group_invite_links WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  PERFORM lock_group(v_link.group_id);

  SELECT * INTO v_link FROM group_invite_links WHERE id = v_link.id FOR UPDATE;

  IF NOT v_link.is_active
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
     OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  PERFORM assert_dm_pair_allowed(v_link.group_id, v_actor);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = v_link.group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status INTO v_status FROM group_members
  WHERE group_id = v_link.group_id AND user_id = v_actor
  FOR UPDATE;

  IF FOUND AND v_status = 'accepted' THEN
    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_link.group_id;
    RETURN jsonb_build_object(
      'groupId', v_link.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  PERFORM public.assert_user_contact_allowed(v_actor, v_link.created_by);

  SELECT creator_id INTO v_creator FROM public.groups WHERE id = v_link.group_id;
  PERFORM public.assert_user_contact_allowed(v_actor, v_creator);

  UPDATE group_invite_links
  SET use_count = use_count + 1
  WHERE id = v_link.id;

  IF FOUND AND v_status = 'invited' THEN
    UPDATE group_members
    SET status = 'accepted', accepted_at = now()
    WHERE group_id = v_link.group_id AND user_id = v_actor;
  ELSE
    INSERT INTO group_members (group_id, user_id, status, accepted_at)
    VALUES (v_link.group_id, v_actor, 'accepted', now());
  END IF;

  -- Shared-history latch: joining a group whose facts already exist makes
  -- them shared from this moment.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_link.group_id
    AND financial_history_shared_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.expenses WHERE group_id = v_link.group_id)
         OR EXISTS (SELECT 1 FROM public.settlements WHERE group_id = v_link.group_id));

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_link.group_id;

  v_event_id := emit_event(
    v_link.group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(v_link.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', v_link.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_via_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_via_link(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_guest_participant(p_guest_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_rec RECORD;
  v_ledger_version bigint;
  v_event_id bigint;
  v_creator uuid;
BEGIN
  v_actor := public.current_user_id();

  IF p_guest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  -- Identify the guest's group unlocked so the group lock is always taken
  -- before the guest/expense row locks, exactly as the former claim_guest
  -- body ordered them. Both callers already hold this lock; re-acquiring it
  -- in the same transaction is a no-op and keeps this helper safe for any
  -- future internal caller that arrives without it.
  SELECT e.group_id
  INTO v_group_id
  FROM public.guests g
  JOIN public.expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  PERFORM public.lock_group(v_group_id);

  SELECT g.id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.creator_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM public.guests g
  JOIN public.expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id
  FOR UPDATE OF g, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_claimed';
  END IF;

  IF v_rec.expense_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  -- A guest dropped by a later edit keeps its row but no participant slot;
  -- redeeming that orphaned token would hand group membership to a stranger.
  IF NOT EXISTS (
    SELECT 1 FROM public.current_expense_participants
    WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.current_expense_participants
    WHERE expense_id = v_rec.expense_id AND user_id = v_actor AND kind = 'user'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_participant';
  END IF;

  PERFORM public.assert_dm_pair_allowed(v_rec.group_id, v_actor);

  IF EXISTS (
    SELECT 1 FROM public.group_member_exclusions
    WHERE group_id = v_rec.group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  PERFORM public.assert_user_contact_allowed(v_actor, v_rec.creator_id);

  SELECT creator_id INTO v_creator FROM public.groups WHERE id = v_rec.group_id;
  PERFORM public.assert_user_contact_allowed(v_actor, v_creator);

  UPDATE public.guests
  SET claimed_by = v_actor,
      claimed_at = now(),
      claimed_version_no = v_rec.current_version_no
  WHERE id = v_rec.id;

  INSERT INTO public.group_members (group_id, user_id, status, accepted_at)
  VALUES (v_rec.group_id, v_actor, 'accepted', now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = 'accepted', accepted_at = COALESCE(public.group_members.accepted_at, now());

  -- Shared-history latch: the claim just granted membership for an existing
  -- expense to a new user, so the expense's facts are shared from now on.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_rec.group_id AND financial_history_shared_at IS NULL;

  v_ledger_version := public.recompute_group_balances(v_rec.group_id);

  v_event_id := public.emit_event(
    p_group_id => v_rec.group_id,
    p_kind => 'guest_claimed',
    p_actor => v_actor,
    p_expense_id => v_rec.expense_id,
    p_settlement_id => NULL,
    p_subject_user_id => v_actor,
    p_payload => jsonb_build_object('displayName', v_rec.display_name)
  );

  PERFORM public.broadcast_group(v_rec.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_rec.expense_id,
    'groupId', v_rec.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_participant(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_settlement(
  p_operation_id uuid,
  p_group_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount_cents integer,
  p_allow_overpay boolean DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_existing RECORD;
  v_settlement_id uuid;
  v_ledger_version bigint;
  v_from_net bigint;
  v_to_net bigint;
  v_event_id bigint;
  v_subject_user_id uuid;
BEGIN
  v_actor := current_user_id();

  IF p_operation_id IS NULL OR p_group_id IS NULL
     OR p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF v_actor <> p_from_user_id AND v_actor <> p_to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_party';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT * INTO v_existing FROM settlements WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.from_user_id <> p_from_user_id OR v_existing.group_id <> p_group_id
       OR v_existing.to_user_id <> p_to_user_id OR v_existing.amount_cents <> p_amount_cents THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    IF v_existing.status = 'voided' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_voided';
    END IF;

    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;
    RETURN jsonb_build_object(
      'settlementId', v_existing.id,
      'groupId', v_existing.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  -- Checked only on the fresh-insert path: a replay of an operation settled
  -- before the block must still return its original ack, while a new
  -- settlement is refused in both directions of a blocked pair.
  PERFORM public.assert_user_contact_allowed(v_actor, p_from_user_id);
  PERFORM public.assert_user_contact_allowed(v_actor, p_to_user_id);

  IF NOT is_member(p_group_id, CASE WHEN v_actor = p_from_user_id THEN p_to_user_id ELSE p_from_user_id END) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'counterparty_not_member';
  END IF;

  SELECT COALESCE((
    SELECT net_cents FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_from_user_id
  ), 0) INTO v_from_net;
  SELECT COALESCE((
    SELECT net_cents FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_to_user_id
  ), 0) INTO v_to_net;

  IF NOT COALESCE(p_allow_overpay, false) THEN
    IF v_from_net >= 0 OR p_amount_cents > -v_from_net
       OR v_to_net <= 0 OR p_amount_cents > v_to_net THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'amount_exceeds_debt';
    END IF;
  END IF;

  INSERT INTO settlements (operation_id, group_id, from_user_id, to_user_id, amount_cents, status, confirmed_at, created_by)
  VALUES (p_operation_id, p_group_id, p_from_user_id, p_to_user_id, p_amount_cents, 'confirmed', now(), v_actor)
  RETURNING id INTO v_settlement_id;

  -- Shared-history latch: any confirmed settlement is shared financial
  -- history by definition.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = p_group_id AND financial_history_shared_at IS NULL;

  v_ledger_version := recompute_group_balances(p_group_id);

  v_subject_user_id := CASE WHEN v_actor = p_from_user_id THEN p_to_user_id ELSE p_from_user_id END;

  v_event_id := emit_event(
    p_group_id,
    'settlement_recorded',
    v_actor,
    p_settlement_id => v_settlement_id,
    p_subject_user_id => v_subject_user_id,
    p_payload => jsonb_build_object('amountCents', p_amount_cents, 'fromUserId', p_from_user_id, 'toUserId', p_to_user_id)
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'settlementId', v_settlement_id,
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_settlement(uuid, uuid, uuid, uuid, integer, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.record_settlement(uuid, uuid, uuid, uuid, integer, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_expense_with_group(
  p_client_id uuid, p_group_name text, p_member_ids uuid[],
  p_occurred_on date, p_title text, p_merchant_name text,
  p_expense_type expense_type, p_total_cents integer,
  p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb, p_chave_acesso text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_existing_id uuid;
  v_existing_group_id uuid;
  v_existing_status public.expense_status;
  v_existing_version_no integer;
  v_existing_ledger_version bigint;
  v_group jsonb;
  v_group_id uuid;
BEGIN
  v_actor := current_user_id();

  -- Serialize retries on the client-supplied identity before looking for an
  -- existing expense. Without this lock, two concurrent retries both miss
  -- the pre-check, both create their own group, and the loser then replays
  -- the winner's expense against its own doomed group, which rolls back
  -- with invalid_argument instead of the replay ack the caller deserves.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('create_expense_with_group:' || p_client_id::text, 0)
  );

  SELECT id, group_id, status, current_version_no
    INTO v_existing_id, v_existing_group_id, v_existing_status, v_existing_version_no
  FROM expenses WHERE client_id = p_client_id;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status = 'deleted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
    END IF;
    -- A replay must belong to the caller; another member's expense is not
    -- theirs to read back.
    PERFORM assert_member(v_existing_group_id, v_actor);
    SELECT ledger_version INTO v_existing_ledger_version
    FROM groups WHERE id = v_existing_group_id;
    RETURN jsonb_build_object(
      'expenseId', v_existing_id,
      'groupId', v_existing_group_id,
      'versionNo', v_existing_version_no,
      'ledgerVersion', v_existing_ledger_version,
      'eventId', NULL
    );
  END IF;

  -- Validated before create_group so its per-member contact checks cannot
  -- double as a probe for incoming blocks: an invalid payload raises
  -- invalid_payload for every member id and creates nothing.
  PERFORM public.validate_expense_payload(
    p_payload, p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents
  );

  v_group := create_group(p_group_name, p_member_ids);
  v_group_id := (v_group->>'groupId')::uuid;

  RETURN create_expense(
    p_client_id, v_group_id, p_occurred_on, p_title, p_merchant_name,
    p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents,
    p_payload, p_chave_acesso
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense_with_group(uuid, text, uuid[], date, text, text, expense_type, integer, integer, integer, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_expense_with_group(uuid, text, uuid[], date, text, text, expense_type, integer, integer, integer, jsonb, text) TO authenticated;
