-- The audit measured unthrottled abuse: thousands of attacker-named groups
-- flooding one victim's bootstrap, unlimited invite/decline cycles, chat
-- floods and self-owned row spam. These RPCs now consult the existing
-- increment_rate_limit buckets, an inviter may hold at most 10 pending
-- invitations to the same person (a global per-invitee cap would let
-- spammers lock a victim out of real invitations), and blocking someone
-- clears their pending invitations to the blocker when the invitation
-- carries no ledger footprint; invitations naming the blocker on a bill
-- stay declinable so the blocker's share is converted, never stranded.

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_member_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_name text;
  v_clean_member_ids uuid[];
  v_group_id uuid;
  v_ledger_version bigint;
  v_event_id bigint;
  v_subject_user_id uuid;
BEGIN
  v_actor := public.current_user_id();

  v_name := btrim(p_name);
  IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
  END IF;

  IF cardinality(p_member_ids) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::uuid[])
  INTO v_clean_member_ids
  FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) AS u
  WHERE u <> v_actor;

  IF COALESCE(array_length(v_clean_member_ids, 1), 0) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM unnest(v_clean_member_ids) AS target_user_id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = target_user_id AND u.onboarded AND u.deleted_at IS NULL
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
    END IF;
    PERFORM public.assert_user_contact_allowed(v_actor, u)
    FROM unnest(v_clean_member_ids) AS u;

    IF EXISTS (
      SELECT 1 FROM unnest(v_clean_member_ids) AS target_user_id
      WHERE (
        SELECT count(*)
        FROM public.group_members gm
        WHERE gm.user_id = target_user_id
          AND gm.status = 'invited'
          AND gm.invited_by = v_actor
      ) >= 10
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_limit';
    END IF;
  END IF;

  IF NOT public.increment_rate_limit('group_creates', v_actor::text, 30, 3600) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_rate_limited';
  END IF;

  INSERT INTO public.groups (kind, name, creator_id)
  VALUES ('group', v_name, v_actor)
  RETURNING id, ledger_version INTO v_group_id, v_ledger_version;

  INSERT INTO public.group_members (group_id, user_id, status, accepted_at)
  VALUES (v_group_id, v_actor, 'accepted', now());

  IF COALESCE(array_length(v_clean_member_ids, 1), 0) > 0 THEN
    INSERT INTO public.group_members (group_id, user_id, status, invited_by)
    SELECT v_group_id, u, 'invited', v_actor
    FROM unnest(v_clean_member_ids) AS u;

    v_subject_user_id := CASE WHEN array_length(v_clean_member_ids, 1) = 1 THEN v_clean_member_ids[1] ELSE NULL END;
    v_event_id := public.emit_event(
      v_group_id,
      'member_invited',
      v_actor,
      p_subject_user_id => v_subject_user_id,
      p_payload => jsonb_build_object('userIds', to_jsonb(v_clean_member_ids))
    );
    PERFORM public.broadcast_group(v_group_id, v_ledger_version, v_event_id);
    PERFORM public.broadcast_user(u, v_group_id) FROM unnest(v_clean_member_ids) AS u;
  ELSE
    v_event_id := NULL;
  END IF;

  RETURN jsonb_build_object(
    'groupId', v_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_group(p_name text, p_member_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_group(p_name text, p_member_ids uuid[])
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.invite_member(p_group_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := public.current_user_id();

  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT public.increment_rate_limit('invites_sent', v_actor::text, 100, 3600) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_rate_limited';
  END IF;

  PERFORM public.lock_group(p_group_id);
  PERFORM public.assert_member(p_group_id, v_actor);
  PERFORM public.assert_dm_pair_allowed(p_group_id, p_user_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND u.onboarded AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;
  SELECT creator_id, ledger_version INTO v_creator_id, v_ledger_version FROM public.groups WHERE id = p_group_id;

  IF EXISTS (SELECT 1 FROM public.group_member_exclusions WHERE group_id = p_group_id AND user_id = p_user_id) THEN
    IF v_actor = v_creator_id THEN
      DELETE FROM public.group_member_exclusions WHERE group_id = p_group_id AND user_id = p_user_id;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
    END IF;
  END IF;

  SELECT status INTO v_status FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
  IF FOUND THEN
    IF v_status = 'accepted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_member';
    ELSIF v_status = 'invited' THEN
      SELECT ledger_version INTO v_ledger_version FROM public.groups WHERE id = p_group_id;
      RETURN jsonb_build_object(
        'groupId', p_group_id,
        'ledgerVersion', v_ledger_version,
        'eventId', NULL
      );
    END IF;
  END IF;
  PERFORM public.assert_user_contact_allowed(v_actor, p_user_id);

  IF (
    SELECT count(*)
    FROM public.group_members gm
    WHERE gm.user_id = p_user_id
      AND gm.status = 'invited'
      AND gm.invited_by = v_actor
  ) >= 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invite_limit';
  END IF;

  INSERT INTO public.group_members (group_id, user_id, status, invited_by)
  VALUES (p_group_id, p_user_id, 'invited', v_actor);

  SELECT ledger_version INTO v_ledger_version FROM public.groups WHERE id = p_group_id;

  v_event_id := public.emit_event(
    p_group_id,
    'member_invited',
    v_actor,
    p_subject_user_id => p_user_id,
    p_payload => jsonb_build_object('userIds', jsonb_build_array(p_user_id))
  );

  PERFORM public.broadcast_group(p_group_id, v_ledger_version, v_event_id);
  PERFORM public.broadcast_user(p_user_id, p_group_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.invite_member(p_group_id uuid, p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_member(p_group_id uuid, p_user_id uuid)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.get_or_create_dm(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.get_or_create_dm(p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(p_user_id uuid)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.send_message(p_client_id uuid, p_group_id uuid, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_content text;
  v_existing_id uuid;
  v_existing_sender uuid;
  v_existing_group uuid;
  v_message_id uuid;
  v_created_at timestamptz;
  v_result jsonb;
  v_rec record;
BEGIN
  v_actor := public.current_user_id();

  IF p_client_id IS NULL OR p_group_id IS NULL OR p_content IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_content := trim(p_content);
  IF length(v_content) < 1 OR length(v_content) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT public.increment_rate_limit('chat_messages', v_actor::text || ':' || p_group_id::text, 30, 60) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'message_rate_limited';
  END IF;

  -- Serialise message creation with reads and other chat writers for this group.
  PERFORM public.lock_group(p_group_id);
  PERFORM public.assert_member(p_group_id, v_actor);

  SELECT id, sender_id, group_id INTO v_existing_id, v_existing_sender, v_existing_group
  FROM public.chat_messages
  WHERE client_id = p_client_id;

  IF FOUND THEN
    IF v_existing_sender <> v_actor OR v_existing_group <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.ledger_chat_message_json(v_existing_id);
  END IF;
  PERFORM public.assert_user_contact_allowed(
    v_actor,
    CASE WHEN g.dm_user_a = v_actor THEN g.dm_user_b ELSE g.dm_user_a END
  )
  FROM public.groups g
  WHERE g.id = p_group_id AND g.kind = 'dm';

  SELECT GREATEST(
    clock_timestamp(),
    COALESCE(max(created_at) + interval '1 microsecond', '-infinity'::timestamptz)
  )
  INTO v_created_at
  FROM public.chat_messages
  WHERE group_id = p_group_id;

  -- Concurrent retries of the same client_id must both resolve to one row.
  INSERT INTO public.chat_messages (client_id, group_id, sender_id, content, created_at)
  VALUES (p_client_id, p_group_id, v_actor, v_content, v_created_at)
  ON CONFLICT (client_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT id, sender_id, group_id INTO v_existing_id, v_existing_sender, v_existing_group
    FROM public.chat_messages WHERE client_id = p_client_id;
    IF v_existing_sender <> v_actor OR v_existing_group <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.ledger_chat_message_json(v_existing_id);
  END IF;

  v_result := public.ledger_chat_message_json(v_message_id);

  FOR v_rec IN
    SELECT gm.user_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.status = 'accepted'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks b
        WHERE b.blocker_id = gm.user_id AND b.blocked_id = v_actor
      )
    FOR SHARE OF gm
  LOOP
    PERFORM realtime.send(
      jsonb_build_object('group_id', p_group_id, 'message', v_result),
      'message',
      'user:' || v_rec.user_id::text,
      true
    );
  END LOOP;

  -- Conversation lists subscribe per group, not per chat topic: this wakes
  -- them without inserting a fake financial event into the ledger stream.
  PERFORM realtime.send(
    jsonb_build_object('group_id', p_group_id),
    'chat_activity',
    'group:' || p_group_id::text,
    true
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_message(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_vendor_charge(p_amount_cents integer, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_row vendor_charges;
BEGIN
  v_actor := public.current_user_id();

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_description IS NOT NULL AND length(p_description) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT public.increment_rate_limit('vendor_charges', v_actor::text, 60, 3600) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'charge_rate_limited';
  END IF;

  INSERT INTO public.vendor_charges (user_id, amount_cents, description, status, created_at)
  VALUES (v_actor, p_amount_cents, p_description, 'pending', now())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'userId', v_row.user_id,
    'amountCents', v_row.amount_cents,
    'description', v_row.description,
    'status', v_row.status,
    'createdAt', to_jsonb(v_row.created_at),
    'confirmedAt', to_jsonb(v_row.confirmed_at)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_vendor_charge(integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_vendor_charge(integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.block_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  IF p_user_id IS NULL OR p_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF NOT public.increment_rate_limit('user_blocks', v_actor::text, 30, 3600) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'block_rate_limited';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND onboarded) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;
  PERFORM 1 FROM public.users WHERE id = v_actor FOR NO KEY UPDATE;
  INSERT INTO public.user_blocks(blocker_id, blocked_id) VALUES (v_actor, p_user_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  DELETE FROM public.group_members gm
  WHERE gm.user_id = v_actor
    AND gm.invited_by = p_user_id
    AND gm.status = 'invited'
    AND NOT EXISTS (
      SELECT 1 FROM public.group_balances gb
      WHERE gb.group_id = gm.group_id AND gb.kind = 'user' AND gb.participant_id = v_actor
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.current_expense_participants cep
      JOIN public.expenses e ON e.id = cep.expense_id
      WHERE e.group_id = gm.group_id AND cep.user_id = v_actor
    );

  PERFORM realtime.send('{}'::jsonb, 'blocks_changed', 'user:' || v_actor::text, true);
  RETURN public.get_user_blocks();
END;
$function$;

REVOKE ALL ON FUNCTION public.block_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated, service_role;
