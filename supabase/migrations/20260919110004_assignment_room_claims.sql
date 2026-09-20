CREATE FUNCTION public.set_assignment_room_claim(
  p_room_id uuid,
  p_member_token text,
  p_item_id uuid,
  p_participant_id uuid,
  p_expected_item_revision bigint,
  p_ticks bigint
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_room public.assignment_rooms%ROWTYPE;
  v_item public.assignment_room_items%ROWTYPE;
  v_target public.assignment_room_participants%ROWTYPE;
  v_self_participant_id uuid;
  v_member_digest bytea;
  v_is_host boolean := false;
  v_current_ticks bigint;
  v_other_ticks bigint;
  v_capacity bigint;
BEGIN
  IF p_room_id IS NULL OR p_item_id IS NULL OR p_participant_id IS NULL
     OR p_expected_item_revision IS NULL OR p_expected_item_revision < 1
     OR p_ticks IS NULL OR p_ticks < 0 OR p_ticks > 119999999880
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_member_token IS NOT NULL
     AND p_member_token !~ '^armm1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF p_member_token IS NULL THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
    END IF;
    IF v_actor <> v_room.host_user_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
    END IF;
    v_is_host := true;
    SELECT id INTO v_self_participant_id
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id
      AND user_id = v_actor
      AND removed_at IS NULL
    FOR UPDATE;
  ELSE
    v_member_digest := extensions.digest(
      convert_to(p_member_token, 'UTF8'),
      'sha256'
    );
    SELECT m.participant_id INTO v_self_participant_id
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
  END IF;

  IF v_room.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
  END IF;
  IF v_room.status = 'finalized'
     OR (v_room.status = 'closed' AND NOT v_is_host)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;
  IF NOT v_is_host AND p_participant_id <> v_self_participant_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;

  SELECT * INTO v_item
  FROM public.assignment_room_items
  WHERE room_id = p_room_id AND id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'item_unavailable';
  END IF;

  SELECT * INTO v_target
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id
    AND id = p_participant_id
    AND removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;

  SELECT ticks INTO v_current_ticks
  FROM public.assignment_room_claims
  WHERE room_id = p_room_id
    AND item_id = p_item_id
    AND participant_id = p_participant_id
  FOR UPDATE;
  v_current_ticks := COALESCE(v_current_ticks, 0);
  IF v_current_ticks = p_ticks THEN
    RETURN public.assignment_room_view(
      p_room_id,
      v_self_participant_id,
      v_is_host
    );
  END IF;
  IF v_item.revision <> p_expected_item_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  SELECT COALESCE(sum(c.ticks), 0) INTO v_other_ticks
  FROM public.assignment_room_claims c
  JOIN public.assignment_room_participants p
    ON p.room_id = c.room_id AND p.id = c.participant_id
  WHERE c.room_id = p_room_id
    AND c.item_id = p_item_id
    AND c.participant_id <> p_participant_id
    AND p.removed_at IS NULL;
  v_capacity := v_item.quantity_milliunits::bigint * 120;
  IF v_other_ticks + p_ticks > v_capacity THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'item_unavailable';
  END IF;

  IF p_ticks = 0 THEN
    DELETE FROM public.assignment_room_claims
    WHERE room_id = p_room_id
      AND item_id = p_item_id
      AND participant_id = p_participant_id;
  ELSE
    INSERT INTO public.assignment_room_claims (
      room_id, item_id, participant_id, ticks
    ) VALUES (
      p_room_id, p_item_id, p_participant_id, p_ticks
    )
    ON CONFLICT (room_id, item_id, participant_id) DO UPDATE
    SET ticks = EXCLUDED.ticks;
  END IF;

  UPDATE public.assignment_room_items
  SET revision = revision + 1
  WHERE room_id = p_room_id AND id = p_item_id;
  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE id = p_room_id;
  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN public.assignment_room_view(
    p_room_id,
    v_self_participant_id,
    v_is_host
  );
END;
$$;

CREATE FUNCTION public.close_assignment_room(
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
  WHERE room_id = p_room_id
    AND user_id = v_actor
    AND removed_at IS NULL
  FOR UPDATE;

  IF v_room.status = 'closed' THEN
    RETURN public.assignment_room_view(
      p_room_id,
      v_host_participant_id,
      true
    );
  END IF;
  IF v_room.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;
  IF v_room.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.assignment_room_items i
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(c.ticks), 0) AS claimed_ticks
      FROM public.assignment_room_claims c
      JOIN public.assignment_room_participants p
        ON p.room_id = c.room_id AND p.id = c.participant_id
      WHERE c.room_id = i.room_id
        AND c.item_id = i.id
        AND p.removed_at IS NULL
    ) claims ON true
    WHERE i.room_id = p_room_id
      AND claims.claimed_ticks <> i.quantity_milliunits::bigint * 120
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;

  PERFORM 1
  FROM guest_credentials.assignment_room_access
  WHERE room_id = p_room_id
  FOR UPDATE;
  UPDATE guest_credentials.assignment_room_access
  SET join_expires_at = clock_timestamp()
  WHERE room_id = p_room_id;
  UPDATE public.assignment_rooms
  SET status = 'closed',
      closed_at = clock_timestamp(),
      revision = revision + 1
  WHERE id = p_room_id;

  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN public.assignment_room_view(
    p_room_id,
    v_host_participant_id,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_assignment_room_claim(uuid, text, uuid, uuid, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_assignment_room(uuid, bigint)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_assignment_room_claim(uuid, text, uuid, uuid, bigint, bigint)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_assignment_room(uuid, bigint)
  TO authenticated;
