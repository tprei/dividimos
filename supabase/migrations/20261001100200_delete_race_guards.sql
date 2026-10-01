-- Serializes account deletion against the account's own in-flight RPCs and
-- prevents ghost-account resurrection via concurrent writes or retried
-- deletions.

-- current_user_id takes the account's deletion advisory lock in shared mode.
-- delete_account holds the same key exclusively for its whole transaction,
-- so an RPC that starts during a deletion waits and then re-reads
-- deleted_at, and one already running finishes before deletion begins.
-- Shared holders never conflict with each other, and advisory locks never
-- interact with row locks, so concurrent RPCs by the same user and peer
-- RPCs that lock user rows keep their previous behavior. Advisory locks are
-- permitted in the read-only transactions PostgREST uses for STABLE reads.
CREATE OR REPLACE FUNCTION public.current_user_id() RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(v_user_id::text, 27110200));
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_user_id AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'account_deleted';
  END IF;
  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_id() FROM PUBLIC, anon, authenticated;

-- delete_account keeps its original lock order (advisory, groups, rooms,
-- then the user row) so peer RPCs that lock a group before touching this
-- user's row cannot deadlock with it, and anonymizes plus cleans up
-- unconditionally so a retry repairs a half-written ghost.
CREATE OR REPLACE FUNCTION public.delete_account(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_at timestamptz;
  v_groups uuid[];
  v_group_id uuid;
  v_room_id uuid;
  v_message_id uuid;
  v_refusal jsonb;
  v_handle text;
  v_constraint text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 27110200));
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  SELECT COALESCE(array_agg(g.id ORDER BY g.id), ARRAY[]::uuid[]) INTO v_groups
  FROM public.groups g
  WHERE g.creator_id = p_user_id OR g.dm_user_a = p_user_id OR g.dm_user_b = p_user_id
    OR EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = g.id AND gm.user_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.group_balances gb WHERE gb.group_id = g.id AND gb.kind = 'user' AND gb.participant_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.group_id = g.id AND m.sender_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.group_events ev WHERE ev.group_id = g.id AND (ev.actor_id = p_user_id OR ev.subject_user_id = p_user_id));
  FOREACH v_group_id IN ARRAY v_groups LOOP
    PERFORM public.lock_group(v_group_id);
  END LOOP;

  FOR v_room_id IN
    SELECT r.id FROM public.assignment_rooms r
    WHERE r.host_user_id = p_user_id OR EXISTS (
      SELECT 1 FROM public.assignment_room_participants p WHERE p.room_id = r.id AND p.user_id = p_user_id
    ) ORDER BY r.id
  LOOP
    PERFORM 1 FROM public.assignment_rooms WHERE id = v_room_id FOR UPDATE;
  END LOOP;

  SELECT deleted_at INTO v_deleted_at FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF v_deleted_at IS NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'name', CASE WHEN g.kind = 'dm' THEN 'Conversa com ' || u.name ELSE g.name END
    ) ORDER BY g.id), '[]'::jsonb) INTO v_refusal
    FROM public.group_balances gb
    JOIN public.groups g ON g.id = gb.group_id
    LEFT JOIN public.users u ON u.id = CASE WHEN g.dm_user_a = p_user_id THEN g.dm_user_b ELSE g.dm_user_a END
    WHERE gb.kind = 'user' AND gb.participant_id = p_user_id;
    IF jsonb_array_length(v_refusal) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance',
        DETAIL = jsonb_build_object('groups', v_refusal)::text;
    END IF;
  END IF;

  LOOP
    v_handle := 'deleted_' || encode(extensions.gen_random_bytes(11), 'hex');
    BEGIN
      UPDATE public.users SET
        name = 'Conta excluída', email = '', handle = v_handle,
        avatar_url = NULL, pix_key_type = NULL, pix_key_hint = NULL, pix_key_encrypted = NULL,
        onboarded = false, is_bot = false,
        notification_preferences = '{"expenses":false,"settlements":false,"nudges":false,"groups":false,"messages":false}'::jsonb,
        deleted_at = COALESCE(deleted_at, now()), updated_at = now()
      WHERE id = p_user_id RETURNING deleted_at INTO v_deleted_at;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint <> 'users_handle_key' THEN RAISE; END IF;
    END;
  END LOOP;

  UPDATE public.groups g SET creator_id = successor.user_id
  FROM LATERAL (
    SELECT gm.group_id, gm.user_id,
      row_number() OVER (PARTITION BY gm.group_id ORDER BY gm.accepted_at NULLS LAST, gm.created_at, gm.user_id) AS position
    FROM public.group_members gm
    JOIN public.users u ON u.id = gm.user_id
    WHERE gm.user_id <> p_user_id AND gm.status = 'accepted' AND u.deleted_at IS NULL
  ) successor
  WHERE g.creator_id = p_user_id AND successor.group_id = g.id AND successor.position = 1;

  DELETE FROM public.group_members WHERE user_id = p_user_id;
  UPDATE public.group_invite_links SET is_active = false WHERE created_by = p_user_id AND is_active;
  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  DELETE FROM public.conversation_reads WHERE user_id = p_user_id;
  DELETE FROM public.vendor_charges WHERE user_id = p_user_id;
  DELETE FROM public.rate_limit_counters WHERE subject = p_user_id::text;
  UPDATE public.guests SET display_name = 'Conta excluída' WHERE claimed_by = p_user_id;
  UPDATE public.expense_versions v
  SET payload = jsonb_set(v.payload, '{participants}', (
    SELECT jsonb_agg(
      CASE WHEN g.id IS NOT NULL
        THEN p.value || jsonb_build_object('displayName', 'Conta excluída')
        ELSE p.value
      END ORDER BY p.ordinality)
    FROM jsonb_array_elements(v.payload->'participants') WITH ORDINALITY AS p(value, ordinality)
    LEFT JOIN public.guests g
      ON p.value->>'kind' = 'guest' AND g.id = (p.value->>'guestId')::uuid AND g.claimed_by = p_user_id
  ))
  WHERE v.expense_id IN (SELECT expense_id FROM public.guests WHERE claimed_by = p_user_id);
  UPDATE public.group_events
  SET payload = jsonb_set(payload, '{displayName}', to_jsonb('Conta excluída'::text))
  WHERE kind = 'guest_claimed' AND subject_user_id = p_user_id AND payload ? 'displayName';
  UPDATE public.group_events SET notified_at = now()
  WHERE actor_id = p_user_id AND notified_at IS NULL;
  DELETE FROM public.user_blocks WHERE blocker_id = p_user_id OR blocked_id = p_user_id;
  DELETE FROM public.dm_opt_outs WHERE user_id = p_user_id OR other_user_id = p_user_id;

  DELETE FROM guest_credentials.assignment_room_members m
  USING public.assignment_room_participants p
  WHERE m.room_id = p.room_id AND m.participant_id = p.id AND p.user_id = p_user_id;

  WITH removed AS (
    DELETE FROM public.assignment_room_claims c
    USING public.assignment_room_participants p, public.assignment_rooms r
    WHERE c.room_id = p.room_id AND c.participant_id = p.id
      AND r.id = c.room_id AND r.status <> 'finalized' AND p.user_id = p_user_id
    RETURNING c.room_id, c.item_id
  )
  UPDATE public.assignment_room_items i SET revision = i.revision + 1
  WHERE EXISTS (SELECT 1 FROM removed x WHERE x.room_id = i.room_id AND x.item_id = i.id);

  UPDATE public.assignment_room_participants
  SET display_name = 'Conta excluída', removed_at = COALESCE(removed_at, now())
  WHERE user_id = p_user_id;

  FOR v_room_id IN
    SELECT r.id FROM public.assignment_rooms r
    WHERE r.host_user_id = p_user_id AND r.status <> 'finalized' ORDER BY r.id
  LOOP
    UPDATE public.assignment_rooms SET status = 'cancelled', closed_at = COALESCE(closed_at, now()), revision = revision + 1
    WHERE id = v_room_id;
    PERFORM public.broadcast_assignment_room(v_room_id);
    DELETE FROM public.assignment_rooms WHERE id = v_room_id;
  END LOOP;

  FOR v_room_id IN
    SELECT DISTINCT p.room_id FROM public.assignment_room_participants p
    WHERE p.user_id = p_user_id ORDER BY p.room_id
  LOOP
    UPDATE public.assignment_rooms SET revision = revision + 1 WHERE id = v_room_id;
    PERFORM public.broadcast_assignment_room(v_room_id);
  END LOOP;

  FOR v_message_id IN
    SELECT m.id FROM public.chat_messages m
    WHERE m.sender_id = p_user_id AND m.erased_at IS NULL
    ORDER BY m.group_id, m.created_at, m.id
  LOOP
    PERFORM public.erase_chat_message(v_message_id);
  END LOOP;

  FOREACH v_group_id IN ARRAY v_groups LOOP
    PERFORM public.broadcast_user(gm.user_id, v_group_id)
    FROM public.group_members gm WHERE gm.group_id = v_group_id;
    PERFORM realtime.send(jsonb_build_object('group_id', v_group_id),
      'chat_activity', 'group:' || v_group_id::text, true);
  END LOOP;
  RETURN jsonb_build_object('userId', p_user_id, 'deletedAt', to_jsonb(v_deleted_at));
END;
$$;

REVOKE ALL ON FUNCTION public.delete_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.update_profile(
  p_name text DEFAULT NULL::text,
  p_handle text DEFAULT NULL::text,
  p_notification_preferences jsonb DEFAULT NULL::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_handle text,
  p_name text,
  p_pix_key_encrypted text,
  p_pix_key_hint text,
  p_pix_key_type pix_key_type
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION public.lookup_user_by_handle(p_handle text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  -- Handles are derived from the email local-part at signup, so a
  -- pre-onboarding handle is guessable. Until the user completes public
  -- profile setup, their OAuth name and avatar are not discoverable.
  SELECT COALESCE(public.ledger_user_profile_json(u.id), 'null'::jsonb) INTO v_out
  FROM public.users u
  WHERE u.handle = lower(trim(p_handle))
    AND u.onboarded
    AND u.deleted_at IS NULL;
  RETURN COALESCE(v_out, 'null'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_user_by_handle(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_handle(text) TO service_role;

-- Realtime policies run as the subscribing role, which has no privilege on
-- public.users, so the live-account check for user topics goes through a
-- SECURITY DEFINER helper, mirroring current_user_is_member.
CREATE OR REPLACE FUNCTION public.current_user_is_active() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.deleted_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_is_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated;

DROP POLICY IF EXISTS group_broadcast_authz ON realtime.messages;
CREATE POLICY group_broadcast_authz ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'user:%' THEN
      substring(
        realtime.topic()
        FROM '^user:([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$'
      )::uuid = auth.uid()
      AND public.current_user_is_active()
    ELSE
      public.current_user_is_member(
        substring(
          realtime.topic()
          FROM '^(?:group|chat):([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$'
        )::uuid
      )
  END
);

-- Peer RPCs refuse deleted referenced users with the existing user_not_found.
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
