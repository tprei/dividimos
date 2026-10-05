CREATE OR REPLACE FUNCTION public.join_via_link(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_actor
      AND (public.has_objectionable_text(u.name)
           OR public.has_objectionable_text(u.handle))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.join_via_link(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_via_link(text) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.claim_guest_participant(p_guest_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_actor
      AND (public.has_objectionable_text(u.name)
           OR public.has_objectionable_text(u.handle))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.claim_guest_participant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_participant(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_or_create_dm(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_group_id uuid;
  v_ledger_version bigint;
  v_created boolean;
  v_event_id bigint;
  v_attempt integer;
BEGIN
  v_actor := public.current_user_id();

  IF p_user_id IS NULL OR p_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND u.onboarded AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  PERFORM public.assert_user_contact_allowed(v_actor, p_user_id);

  v_user_a := LEAST(v_actor, p_user_id);
  v_user_b := GREATEST(v_actor, p_user_id);

  SELECT id, ledger_version INTO v_group_id, v_ledger_version
  FROM public.groups
  WHERE dm_user_a = v_user_a AND dm_user_b = v_user_b
  FOR UPDATE;

  IF v_group_id IS NOT NULL THEN
    v_created := false;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = v_actor
        AND (public.has_objectionable_text(u.name)
             OR public.has_objectionable_text(u.handle))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
    END IF;

    IF NOT public.increment_rate_limit('dm_creates', v_actor::text, 30, 3600) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'dm_rate_limited';
    END IF;

    FOR v_attempt IN 1 .. 2 LOOP
      INSERT INTO public.groups (kind, name, creator_id, dm_user_a, dm_user_b)
      VALUES ('dm', '', v_actor, v_user_a, v_user_b)
      ON CONFLICT (dm_user_a, dm_user_b) DO NOTHING
      RETURNING id, ledger_version INTO v_group_id, v_ledger_version;

      IF v_group_id IS NOT NULL THEN
        v_created := true;
        EXIT;
      END IF;

      SELECT id, ledger_version INTO v_group_id, v_ledger_version
      FROM public.groups
      WHERE dm_user_a = v_user_a AND dm_user_b = v_user_b
      FOR UPDATE;

      IF v_group_id IS NOT NULL THEN
        v_created := false;
        EXIT;
      END IF;

      IF v_attempt = 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_not_found';
      END IF;
    END LOOP;
  END IF;

  PERFORM public.lock_group(v_group_id);

  IF EXISTS (
    SELECT 1 FROM public.dm_opt_outs
    WHERE user_id = p_user_id AND other_user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_member_exclusions
    WHERE group_id = v_group_id AND user_id IN (v_actor, p_user_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  IF v_created THEN
    INSERT INTO public.group_members (group_id, user_id, status, accepted_at)
    VALUES (v_group_id, v_actor, 'accepted', now());

    INSERT INTO public.group_members (group_id, user_id, status, invited_by)
    VALUES (v_group_id, p_user_id, 'invited', v_actor);

    v_event_id := public.emit_event(
      v_group_id,
      'member_invited',
      v_actor,
      p_subject_user_id => p_user_id,
      p_payload => jsonb_build_object('userIds', jsonb_build_array(p_user_id))
    );

    PERFORM public.broadcast_user(p_user_id, v_group_id);
  END IF;

  DELETE FROM public.dm_opt_outs
  WHERE user_id = v_actor AND other_user_id = p_user_id;

  RETURN jsonb_build_object(
    'groupId', v_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id,
    'created', v_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO service_role, authenticated;
