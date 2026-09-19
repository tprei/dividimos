CREATE FUNCTION public.join_assignment_room(
  p_room_id uuid,
  p_join_token text,
  p_member_token text,
  p_display_name text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
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

  IF v_actor IS NOT NULL THEN
    SELECT * INTO v_participant
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id
      AND user_id = v_actor
      AND removed_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
    END IF;

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

  v_display_name := btrim(p_display_name);
  IF v_display_name IS NULL OR length(v_display_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT count(*)::integer, COALESCE(max(ordinal), -1) + 1
  INTO v_active_count, v_next_ordinal
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND removed_at IS NULL;
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
$$;

CREATE FUNCTION public.get_assignment_room(
  p_room_id uuid,
  p_member_token text
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_host uuid;
  v_status text;
  v_participant_id uuid;
  v_member_digest bytea;
BEGIN
  IF p_room_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_member_token IS NULL THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
    END IF;
    SELECT r.host_user_id, r.status, p.id
    INTO v_host, v_status, v_participant_id
    FROM public.assignment_rooms r
    JOIN public.assignment_room_participants p
      ON p.room_id = r.id
     AND p.user_id = r.host_user_id
     AND p.removed_at IS NULL
    WHERE r.id = p_room_id;
    IF NOT FOUND OR v_actor <> v_host THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
    END IF;
    IF v_status = 'cancelled' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
    END IF;
    RETURN public.assignment_room_view(p_room_id, v_participant_id, true);
  END IF;

  IF p_member_token !~ '^armm1_[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;
  v_member_digest := extensions.digest(convert_to(p_member_token, 'UTF8'), 'sha256');

  SELECT m.participant_id INTO v_participant_id
  FROM guest_credentials.assignment_room_members m
  JOIN public.assignment_room_participants p
    ON p.room_id = m.room_id AND p.id = m.participant_id
  JOIN public.assignment_rooms r ON r.id = m.room_id
  WHERE m.room_id = p_room_id
    AND m.token_digest = v_member_digest
    AND m.revoked_at IS NULL
    AND m.expires_at > statement_timestamp()
    AND p.removed_at IS NULL
    AND r.status <> 'cancelled';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  RETURN public.assignment_room_view(p_room_id, v_participant_id, false);
END;
$$;

CREATE FUNCTION public.refresh_assignment_room_member(
  p_room_id uuid,
  p_member_token text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_room public.assignment_rooms%ROWTYPE;
  v_participant_id uuid;
  v_member_digest bytea;
BEGIN
  IF p_room_id IS NULL
     OR p_member_token IS NULL
     OR p_member_token !~ '^armm1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;
  v_member_digest := extensions.digest(convert_to(p_member_token, 'UTF8'), 'sha256');

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND OR v_room.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT m.participant_id INTO v_participant_id
  FROM guest_credentials.assignment_room_members m
  JOIN public.assignment_room_participants p
    ON p.room_id = m.room_id AND p.id = m.participant_id
  WHERE m.room_id = p_room_id
    AND m.token_digest = v_member_digest
    AND m.revoked_at IS NULL
    AND m.expires_at > clock_timestamp()
    AND p.removed_at IS NULL
  FOR UPDATE OF m, p;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  UPDATE guest_credentials.assignment_room_members
  SET expires_at = clock_timestamp() + interval '30 days'
  WHERE room_id = p_room_id AND participant_id = v_participant_id;

  RETURN public.assignment_room_view(
    p_room_id,
    v_participant_id,
    v_actor IS NOT NULL AND v_actor = v_room.host_user_id
  );
END;
$$;

CREATE FUNCTION public.remove_assignment_room_participant(
  p_room_id uuid,
  p_participant_id uuid,
  p_expected_revision bigint,
  p_join_token text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_participant public.assignment_room_participants%ROWTYPE;
  v_access guest_credentials.assignment_room_access%ROWTYPE;
  v_host_participant_id uuid;
  v_old_topic text;
  v_new_topic text;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_participant_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_join_token IS NULL
     OR p_join_token !~ '^armj1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;
  IF v_room.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;
  IF v_room.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  SELECT * INTO v_participant
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND id = p_participant_id
  FOR UPDATE;
  IF NOT FOUND OR v_participant.removed_at IS NOT NULL OR v_participant.ordinal = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_access
  FROM guest_credentials.assignment_room_access
  WHERE room_id = p_room_id
  FOR UPDATE;
  v_old_topic := v_access.broadcast_topic;

  UPDATE public.assignment_room_participants
  SET removed_at = clock_timestamp()
  WHERE room_id = p_room_id AND id = p_participant_id;
  DELETE FROM public.assignment_room_claims
  WHERE room_id = p_room_id AND participant_id = p_participant_id;
  UPDATE guest_credentials.assignment_room_members
  SET revoked_at = clock_timestamp()
  WHERE room_id = p_room_id
    AND participant_id = p_participant_id
    AND revoked_at IS NULL;

  v_new_topic := 'assignment-room:' || rtrim(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );
  UPDATE guest_credentials.assignment_room_access
  SET join_digest = extensions.digest(convert_to(p_join_token, 'UTF8'), 'sha256'),
      join_expires_at = clock_timestamp() + interval '7 days',
      broadcast_topic = v_new_topic
  WHERE room_id = p_room_id;
  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE id = p_room_id;

  SELECT id INTO v_host_participant_id
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND user_id = v_actor AND removed_at IS NULL;
  PERFORM public.broadcast_assignment_room(p_room_id, 'access_changed', v_old_topic);
  RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
END;
$$;

CREATE FUNCTION public.cancel_assignment_room(
  p_room_id uuid,
  p_expected_revision bigint
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_host_participant_id uuid;
  v_old_topic text;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND OR v_room.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  SELECT id INTO v_host_participant_id
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND user_id = v_actor AND removed_at IS NULL;
  IF v_room.status = 'cancelled' THEN
    RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;
  IF v_room.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  SELECT broadcast_topic INTO v_old_topic
  FROM guest_credentials.assignment_room_access
  WHERE room_id = p_room_id
  FOR UPDATE;
  UPDATE guest_credentials.assignment_room_access
  SET join_expires_at = clock_timestamp()
  WHERE room_id = p_room_id;
  UPDATE guest_credentials.assignment_room_members
  SET revoked_at = COALESCE(revoked_at, clock_timestamp())
  WHERE room_id = p_room_id;
  UPDATE public.assignment_rooms
  SET status = 'cancelled',
      closed_at = clock_timestamp(),
      revision = revision + 1
  WHERE id = p_room_id;

  PERFORM public.broadcast_assignment_room(p_room_id, 'status', v_old_topic);
  RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
END;
$$;

REVOKE ALL ON FUNCTION public.join_assignment_room(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_assignment_room(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_assignment_room_member(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_assignment_room_participant(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_assignment_room(uuid, bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.join_assignment_room(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_assignment_room(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_assignment_room_member(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_assignment_room_participant(uuid, uuid, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_assignment_room(uuid, bigint) TO authenticated;
