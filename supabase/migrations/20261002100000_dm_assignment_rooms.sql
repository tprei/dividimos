-- assignment rooms open against DMs: only the two DM users can join the room, finalizing records the expense in the DM, and hosted rooms label a DM room with the partner's name
CREATE OR REPLACE FUNCTION public.create_assignment_room(p_room_id uuid, p_group_target jsonb, p_header jsonb, p_items jsonb, p_participants jsonb, p_join_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'guest_credentials', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_receipt jsonb;
  v_group_target jsonb;
  v_group_id uuid;
  v_group_kind public.group_kind;
  v_participants jsonb := '[]'::jsonb;
  v_participant jsonb;
  v_participant_id uuid;
  v_user_id uuid;
  v_display_name text;
  v_profile_name text;
  v_host_participant_id uuid;
  v_index integer;
  v_join_digest bytea;
  v_topic text;
  v_existing public.assignment_rooms%ROWTYPE;
  v_stored_items jsonb;
  v_stored_participants jsonb;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_join_token IS NULL
     OR p_join_token !~ '^armj1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  v_join_digest := extensions.digest(convert_to(p_join_token, 'UTF8'), 'sha256');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_room_id::text, 110001));
  v_receipt := public.validate_assignment_room_receipt(p_header, p_items);

  IF p_group_target IS NULL OR jsonb_typeof(p_group_target) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_group_target)) <> 2
     OR jsonb_typeof(p_group_target->'kind') <> 'string'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_group_target->>'kind' = 'existing' THEN
    IF NOT (p_group_target ? 'groupId') OR jsonb_typeof(p_group_target->'groupId') <> 'string'
       OR (p_group_target->>'groupId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_group_id := (p_group_target->>'groupId')::uuid;
    SELECT kind INTO v_group_kind FROM public.groups WHERE id = v_group_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_not_found';
    END IF;
    PERFORM public.assert_member(v_group_id, v_actor);
    v_group_target := jsonb_build_object('kind', 'existing', 'groupId', v_group_id);
  ELSIF p_group_target->>'kind' = 'new' THEN
    IF NOT (p_group_target ? 'name') OR jsonb_typeof(p_group_target->'name') <> 'string'
       OR length(btrim(p_group_target->>'name')) NOT BETWEEN 1 AND 80
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_group_target := jsonb_build_object('kind', 'new', 'name', btrim(p_group_target->>'name'));
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_participants IS NULL OR jsonb_typeof(p_participants) <> 'array'
     OR jsonb_array_length(p_participants) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF v_group_kind = 'dm' AND jsonb_array_length(p_participants) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  FOR v_index IN 0..jsonb_array_length(p_participants) - 1 LOOP
    v_participant := p_participants->v_index;
    IF v_participant IS NULL OR jsonb_typeof(v_participant) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_participant)) <> 3
       OR NOT (v_participant ?& ARRAY['id', 'displayName', 'userId'])
       OR jsonb_typeof(v_participant->'id') <> 'string'
       OR (v_participant->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_participant->'displayName') <> 'string'
       OR length(btrim(v_participant->>'displayName')) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(v_participant->'userId') NOT IN ('string', 'null')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    v_participant_id := (v_participant->>'id')::uuid;
    v_display_name := btrim(v_participant->>'displayName');
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_participants) p
      WHERE p->>'id' = v_participant_id::text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    IF jsonb_typeof(v_participant->'userId') = 'string' THEN
      IF (v_participant->>'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      v_user_id := (v_participant->>'userId')::uuid;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_participants) p
        WHERE p->>'userId' = v_user_id::text
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      SELECT name INTO v_profile_name FROM public.users WHERE id = v_user_id AND onboarded;
      IF NOT FOUND OR v_display_name <> v_profile_name THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
      END IF;
      PERFORM public.assert_user_contact_allowed(v_actor, v_user_id);
    ELSE
      v_user_id := NULL;
    END IF;

    IF v_index = 0 THEN
      IF v_user_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      v_host_participant_id := v_participant_id;
    ELSIF v_user_id = v_actor THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    v_participants := v_participants || jsonb_build_array(jsonb_build_object(
      'id', v_participant_id,
      'displayName', v_display_name,
      'userId', v_user_id
    ));
  END LOOP;

  SELECT * INTO v_existing FROM public.assignment_rooms WHERE id = p_room_id FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'description', description,
      'quantityMilliunits', quantity_milliunits,
      'unitPriceCents', unit_price_cents,
      'totalPriceCents', total_price_cents
    ) || CASE WHEN icon IS NULL
          THEN '{}'::jsonb
          ELSE jsonb_build_object('icon', icon)
        END
    ORDER BY ordinal), '[]'::jsonb)
    INTO v_stored_items FROM public.assignment_room_items WHERE room_id = p_room_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'displayName', display_name,
      'userId', user_id
    ) ORDER BY ordinal), '[]'::jsonb)
    INTO v_stored_participants FROM public.assignment_room_participants WHERE room_id = p_room_id;

    IF v_existing.host_user_id IS DISTINCT FROM v_actor
       OR v_existing.group_target IS DISTINCT FROM v_group_target
       OR v_existing.header IS DISTINCT FROM v_receipt->'header'
       OR v_stored_items IS DISTINCT FROM v_receipt->'items'
       OR v_stored_participants IS DISTINCT FROM v_participants
       OR NOT EXISTS (
         SELECT 1 FROM guest_credentials.assignment_room_access a
         WHERE a.room_id = p_room_id AND a.join_digest = v_join_digest
       )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
  END IF;

  INSERT INTO public.assignment_rooms (id, host_user_id, group_target, header)
  VALUES (p_room_id, v_actor, v_group_target, v_receipt->'header');

  INSERT INTO public.assignment_room_items (
    room_id, id, ordinal, description, quantity_milliunits, unit_price_cents, total_price_cents, icon
  )
  SELECT p_room_id, gen_random_uuid(), ordinality - 1,
         item->>'description',
         (item->>'quantityMilliunits')::integer,
         (item->>'unitPriceCents')::integer,
         (item->>'totalPriceCents')::integer,
         item->>'icon'
  FROM jsonb_array_elements(v_receipt->'items') WITH ORDINALITY AS rows(item, ordinality);

  INSERT INTO public.assignment_room_participants (room_id, id, ordinal, display_name, user_id)
  SELECT p_room_id,
         (participant->>'id')::uuid,
         ordinality - 1,
         participant->>'displayName',
         CASE WHEN jsonb_typeof(participant->'userId') = 'string'
              THEN (participant->>'userId')::uuid ELSE NULL END
  FROM jsonb_array_elements(v_participants) WITH ORDINALITY AS rows(participant, ordinality);

  v_topic := 'assignment-room:' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  INSERT INTO guest_credentials.assignment_room_access (room_id, join_digest, join_expires_at, broadcast_topic)
  VALUES (p_room_id, v_join_digest, now() + interval '7 days', v_topic);

  RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
EXCEPTION
  WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
END;
$function$;

REVOKE ALL ON FUNCTION public.create_assignment_room(p_room_id uuid, p_group_target jsonb, p_header jsonb, p_items jsonb, p_participants jsonb, p_join_token text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_assignment_room(p_room_id uuid, p_group_target jsonb, p_header jsonb, p_items jsonb, p_participants jsonb, p_join_token text)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.join_assignment_room(p_room_id uuid, p_join_token text, p_member_token text, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'guest_credentials', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_room public.assignment_rooms%ROWTYPE;
  v_access guest_credentials.assignment_room_access%ROWTYPE;
  v_member guest_credentials.assignment_room_members%ROWTYPE;
  v_participant public.assignment_room_participants%ROWTYPE;
  v_join_digest bytea;
  v_member_digest bytea;
  v_display_name text;
  v_active_count integer;
  v_next_ordinal integer;
  v_group_kind public.group_kind;
  v_dm_user_a uuid;
  v_dm_user_b uuid;
  v_dm_room boolean := false;
BEGIN
  IF p_room_id IS NULL
     OR p_join_token IS NULL
     OR p_join_token !~ '^armj1_[A-Za-z0-9_-]{43}$'
     OR p_member_token IS NULL
     OR p_member_token !~ '^armm1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_join_digest := extensions.digest(convert_to(p_join_token, 'UTF8'), 'sha256');
  v_member_digest := extensions.digest(convert_to(p_member_token, 'UTF8'), 'sha256');

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT m.* INTO v_member
  FROM guest_credentials.assignment_room_members m
  JOIN public.assignment_room_participants p
    ON p.room_id = m.room_id AND p.id = m.participant_id
  WHERE m.room_id = p_room_id AND m.token_digest = v_member_digest
  FOR UPDATE OF m, p;
  IF FOUND THEN
    SELECT * INTO v_participant
    FROM public.assignment_room_participants
    WHERE room_id = v_member.room_id AND id = v_member.participant_id
    FOR UPDATE;
    IF v_room.status = 'cancelled'
       OR v_member.revoked_at IS NOT NULL
       OR v_member.expires_at <= clock_timestamp()
       OR v_participant.removed_at IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
    END IF;
    RETURN public.assignment_room_view(
      p_room_id,
      v_participant.id,
      v_actor IS NOT NULL AND v_actor = v_room.host_user_id
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM guest_credentials.assignment_room_members
    WHERE token_digest = v_member_digest
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT * INTO v_access
  FROM guest_credentials.assignment_room_access
  WHERE room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_access.join_digest <> v_join_digest
     OR v_access.join_expires_at <= clock_timestamp()
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

  IF v_room.group_target->>'kind' = 'existing' THEN
    SELECT g.kind, g.dm_user_a, g.dm_user_b
      INTO v_group_kind, v_dm_user_a, v_dm_user_b
    FROM public.groups g
    WHERE g.id = (v_room.group_target->>'groupId')::uuid;
    v_dm_room := v_group_kind IS NOT DISTINCT FROM 'dm';
  END IF;
  IF v_dm_room AND (v_actor IS NULL
     OR (v_actor IS DISTINCT FROM v_dm_user_a AND v_actor IS DISTINCT FROM v_dm_user_b)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'dm_room_pair_only';
  END IF;

  -- An account that never completed onboarding joins as a guest, so
  -- finalization never invites it: the group RPCs refuse users that never
  -- onboarded. It still re-enters through the member token above.
  IF v_actor IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.user_blocks b
       WHERE (b.blocker_id = v_actor AND b.blocked_id = v_room.host_user_id)
          OR (b.blocker_id = v_room.host_user_id AND b.blocked_id = v_actor)
     )
     AND EXISTS (
       SELECT 1 FROM public.users
       WHERE id = v_actor AND onboarded
     ) THEN
    SELECT * INTO v_participant
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id
      AND user_id = v_actor
      AND removed_at IS NULL
    FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO v_member
      FROM guest_credentials.assignment_room_members
      WHERE room_id = p_room_id AND participant_id = v_participant.id
      FOR UPDATE;
      IF FOUND AND v_member.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
      END IF;

      INSERT INTO guest_credentials.assignment_room_members (
        room_id, participant_id, token_digest, expires_at, revoked_at
      ) VALUES (
        p_room_id, v_participant.id, v_member_digest,
        clock_timestamp() + interval '30 days', NULL
      )
      ON CONFLICT (room_id, participant_id) DO UPDATE
      SET token_digest = EXCLUDED.token_digest,
          expires_at = EXCLUDED.expires_at,
          revoked_at = NULL;

      RETURN public.assignment_room_view(
        p_room_id,
        v_participant.id,
        v_actor = v_room.host_user_id
      );
    END IF;

    -- A host who removed this account already released its choices; a
    -- forwarded fresh invitation must not resurrect that participant.
    IF EXISTS (
      SELECT 1
      FROM public.assignment_room_participants
      WHERE room_id = p_room_id AND user_id = v_actor
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
    END IF;

    -- Bearer admission never overrides a group exclusion. Rejecting here keeps
    -- the room recordable: finalization would raise `member_excluded` on a
    -- room that can no longer change hands.
    IF v_room.group_target->>'kind' = 'existing' AND EXISTS (
      SELECT 1
      FROM public.group_member_exclusions
      WHERE group_id = (v_room.group_target->>'groupId')::uuid
        AND user_id = v_actor
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
    END IF;

    -- The account's own profile names it. `p_display_name` is ignored, so a
    -- forged name cannot impersonate somebody else in the room.
    SELECT name INTO v_display_name
    FROM public.users
    WHERE id = v_actor;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
    END IF;
    v_display_name := btrim(v_display_name);
    IF v_display_name IS NULL OR length(v_display_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    -- Capacity counts active rows; the ordinal spans every row, because
    -- `(room_id, ordinal)` is unique and removed participants keep theirs.
    SELECT (count(*) FILTER (WHERE removed_at IS NULL))::integer,
           COALESCE(max(ordinal), -1) + 1
    INTO v_active_count, v_next_ordinal
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id;
    IF v_active_count >= 50 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'too_many_participants';
    END IF;

    INSERT INTO public.assignment_room_participants (
      room_id, id, ordinal, display_name, user_id
    ) VALUES (
      p_room_id, gen_random_uuid(), v_next_ordinal, v_display_name, v_actor
    ) RETURNING * INTO v_participant;

    INSERT INTO guest_credentials.assignment_room_members (
      room_id, participant_id, token_digest, expires_at
    ) VALUES (
      p_room_id, v_participant.id, v_member_digest,
      clock_timestamp() + interval '30 days'
    );

    UPDATE public.assignment_rooms
    SET revision = revision + 1
    WHERE id = p_room_id
    RETURNING * INTO v_room;
    PERFORM public.broadcast_assignment_room(p_room_id);
    RETURN public.assignment_room_view(p_room_id, v_participant.id, false);
  END IF;

  IF v_dm_room THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'dm_room_pair_only';
  END IF;

  v_display_name := btrim(p_display_name);
  -- The client sends an empty name when an account joins, so a signed-in
  -- joiner without onboarding falls back to its own profile name; the
  -- guest validation below decides whether it is usable.
  IF v_actor IS NOT NULL AND COALESCE(v_display_name, '') = '' THEN
    SELECT btrim(name) INTO v_display_name
    FROM public.users
    WHERE id = v_actor;
  END IF;
  IF v_display_name IS NULL OR length(v_display_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT (count(*) FILTER (WHERE removed_at IS NULL))::integer,
         COALESCE(max(ordinal), -1) + 1
  INTO v_active_count, v_next_ordinal
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id;
  IF v_active_count >= 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'too_many_participants';
  END IF;

  INSERT INTO public.assignment_room_participants (
    room_id, id, ordinal, display_name, user_id
  ) VALUES (
    p_room_id, gen_random_uuid(), v_next_ordinal, v_display_name, NULL
  ) RETURNING * INTO v_participant;

  INSERT INTO guest_credentials.assignment_room_members (
    room_id, participant_id, token_digest, expires_at
  ) VALUES (
    p_room_id, v_participant.id, v_member_digest,
    clock_timestamp() + interval '30 days'
  );

  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE id = p_room_id
  RETURNING * INTO v_room;
  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN public.assignment_room_view(p_room_id, v_participant.id, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.join_assignment_room(p_room_id uuid, p_join_token text, p_member_token text, p_display_name text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_assignment_room(p_room_id uuid, p_join_token text, p_member_token text, p_display_name text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_hosted_assignment_rooms()
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  RETURN jsonb_build_object('rooms', COALESCE((
    SELECT jsonb_agg(v.room ORDER BY v.created_at DESC, v.id DESC)
    FROM (
      SELECT public.assignment_room_summary_json(r.id)
             || jsonb_build_object('groupName', CASE WHEN g.kind = 'dm' THEN (
                  SELECT u.name FROM public.users u
                  WHERE u.id = CASE WHEN g.dm_user_a = v_actor THEN g.dm_user_b ELSE g.dm_user_a END
                ) ELSE g.name END) AS room,
             r.created_at,
             r.id
      FROM public.assignment_rooms r
      LEFT JOIN public.groups g
        ON r.group_target->>'kind' = 'existing'
       AND g.id = (r.group_target->>'groupId')::uuid
       AND public.is_member(g.id, v_actor)
      WHERE r.host_user_id = v_actor
        AND r.status IN ('open', 'closed')
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 20
    ) v
  ), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.list_hosted_assignment_rooms()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_hosted_assignment_rooms()
  TO authenticated;
