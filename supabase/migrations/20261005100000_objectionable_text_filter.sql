CREATE FUNCTION public.has_objectionable_text(p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 STRICT
 SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT regexp_replace(
           lower(
             regexp_replace(
               normalize(p_text, NFD),
               U&'[\0300-\036F]',
               '',
               'g'
             ) COLLATE pg_catalog."und-x-icu"
           ),
           '[^[:alnum:]]+', ' ', 'g'
         ) ~ '\m(viad(o|a|os|as|inho|inha|inhos|inhas|ao|oes)|bichon(a|as)|boiol(a|as)|baitol(a|as)|travec(o|os)|mongoloid(e|es)|nigg(er|ers|a|as|ah)|faggots?|fags?|retards?|trann(y|ies)|spics?|chinks?|wetbacks?)\M'
$function$;

REVOKE ALL ON FUNCTION public.has_objectionable_text(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_objectionable_text(text) TO service_role;

CREATE OR REPLACE FUNCTION public.send_message(p_client_id uuid, p_group_id uuid, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  IF public.has_objectionable_text(v_content) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
  END IF;

  IF NOT public.increment_rate_limit('chat_messages', v_actor::text || ':' || p_group_id::text, 30, 60) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'message_rate_limited';
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

REVOKE ALL ON FUNCTION public.send_message(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, uuid, text)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_member_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  IF public.has_objectionable_text(v_name)
     OR EXISTS (
       SELECT 1
       FROM public.users
       WHERE id = v_actor
         AND (public.has_objectionable_text(name) OR public.has_objectionable_text(handle))
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
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

CREATE OR REPLACE FUNCTION public.complete_onboarding(p_handle text, p_name text, p_pix_key_encrypted text, p_pix_key_hint text, p_pix_key_type pix_key_type)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_handle text;
  v_name text;
  v_completed boolean;
  v_constraint text;
BEGIN
  v_actor := public.current_user_id();

  v_handle := lower(btrim(p_handle));
  IF v_handle IS NULL OR v_handle !~ '^[a-z0-9_]{3,30}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_handle';
  END IF;

  v_name := btrim(p_name);
  IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
  END IF;
  IF public.has_objectionable_text(v_name) OR public.has_objectionable_text(v_handle) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
  END IF;

  IF COALESCE(btrim(p_pix_key_encrypted), '') = ''
     OR COALESCE(btrim(p_pix_key_hint), '') = ''
     OR p_pix_key_type IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF COALESCE(p_pix_key_encrypted, '') !~ '^[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$'
     OR length(COALESCE(p_pix_key_encrypted, '')) > 256
     OR length(COALESCE(p_pix_key_hint, '')) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF public.is_reserved_handle(v_handle)
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_actor AND handle = v_handle) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
  END IF;

  BEGIN
    UPDATE public.users
    SET
      name = v_name,
      handle = v_handle,
      pix_key_encrypted = p_pix_key_encrypted,
      pix_key_hint = p_pix_key_hint,
      pix_key_type = p_pix_key_type,
      onboarded = true,
      updated_at = now()
    WHERE id = v_actor AND onboarded = false AND deleted_at IS NULL;
    v_completed := FOUND;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'users_handle_key' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
      END IF;
      RAISE;
  END;

  IF v_completed THEN
    RETURN jsonb_build_object('kind', 'completed');
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_actor AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'account_deleted';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_actor AND onboarded = true) THEN
    RETURN jsonb_build_object('kind', 'already_completed');
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_onboarding(text, text, text, text, pix_key_type) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, text, text, text, pix_key_type)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.update_profile(p_name text DEFAULT NULL::text, p_handle text DEFAULT NULL::text, p_notification_preferences jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_name text;
  v_handle text;
  v_user public.users;
BEGIN
  v_actor := public.current_user_id();

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) < 1 OR length(v_name) > 80 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
    END IF;
  END IF;

  IF p_handle IS NOT NULL THEN
    v_handle := lower(btrim(p_handle));
    IF v_handle !~ '^[a-z0-9_]{3,30}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_handle';
    END IF;
  END IF;

  IF p_notification_preferences IS NOT NULL THEN
    IF jsonb_typeof(p_notification_preferences) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_notification_preferences';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_notification_preferences) AS k(key)
      WHERE k.key NOT IN ('expenses', 'settlements', 'nudges', 'groups', 'messages')
        OR jsonb_typeof(p_notification_preferences -> k.key) <> 'boolean'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_notification_preferences';
    END IF;
  END IF;

  IF v_handle IS NOT NULL THEN
    IF public.is_reserved_handle(v_handle)
       AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_actor AND handle = v_handle) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE handle = v_handle AND id <> v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
    END IF;
  END IF;

  UPDATE public.users
  SET
    name = COALESCE(v_name, name),
    handle = COALESCE(v_handle, handle),
    notification_preferences = notification_preferences || COALESCE(p_notification_preferences, '{}'::jsonb),
    onboarded = true,
    updated_at = now()
  WHERE id = v_actor AND deleted_at IS NULL
  RETURNING * INTO v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'account_deleted';
  END IF;

  IF public.has_objectionable_text(v_user.name) OR public.has_objectionable_text(v_user.handle) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'objectionable_content';
  END IF;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'handle', v_user.handle,
    'name', v_user.name,
    'avatarUrl', v_user.avatar_url,
    'isBot', v_user.is_bot,
    'email', v_user.email,
    'pixKeyType', v_user.pix_key_type,
    'pixKeyHint', v_user.pix_key_hint,
    'onboarded', v_user.onboarded,
    'notificationPreferences', v_user.notification_preferences
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_profile(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_profile(text, text, jsonb)
  TO service_role, authenticated;
