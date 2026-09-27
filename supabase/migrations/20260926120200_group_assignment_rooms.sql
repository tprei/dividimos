-- Assignment rooms targeted at an existing group become visible to that
-- group without a join link: `list_open_assignment_rooms` lists the group's
-- open rooms on the group screen and `enter_group_assignment_room` admits an
-- ACCEPTED member by membership, issuing the same member credential the join
-- link does. The host announces the room in the next migration
-- (20260926120300_announce_assignment_room); the feed/bell exclusion for the
-- event kind lives in 20260926120100_hide_room_opened_events.
-- Rooms stay drafts: nothing here touches `group_balances` or the ledger.
SET lock_timeout = '5s';

CREATE INDEX assignment_rooms_open_group_idx
  ON public.assignment_rooms (
    ((group_target->>'groupId')::uuid),
    created_at DESC,
    id DESC
  )
  WHERE status = 'open' AND group_target->>'kind' = 'existing';

CREATE FUNCTION public.list_open_assignment_rooms(p_group_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  PERFORM public.assert_member(p_group_id, v_actor);
  RETURN jsonb_build_object('rooms', COALESCE((
    SELECT jsonb_agg(v.room ORDER BY v.created_at DESC, v.id DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', r.id,
        'title', r.header->>'title',
        'occurredOn', r.header->>'occurredOn',
        'totalCents', (
          SELECT COALESCE(sum(i.total_price_cents), 0)
            + floor((
              COALESCE(sum(i.total_price_cents), 0)::numeric
                * (r.header->>'serviceFeeBasisPoints')::integer
              + 5000
            ) / 10000)
            + (r.header->>'fixedFeeCents')::integer
          FROM public.assignment_room_items i
          WHERE i.room_id = r.id
        ),
        'host', public.ledger_user_profile_json(r.host_user_id),
        'createdAt', to_jsonb(r.created_at),
        'joined', EXISTS (
          SELECT 1
          FROM public.assignment_room_participants p
          WHERE p.room_id = r.id
            AND p.user_id = v_actor
            AND p.removed_at IS NULL
        )
      ) AS room,
      r.created_at,
      r.id
      FROM public.assignment_rooms r
      WHERE r.status = 'open'
        AND r.group_target->>'kind' = 'existing'
        AND (r.group_target->>'groupId')::uuid = p_group_id
        -- A caller whose participant row the host removed (and who has no
        -- active row anymore) must not see the room: enter would answer
        -- invalid_token, so the card would dangle forever.
        AND NOT (
          EXISTS (
            SELECT 1
            FROM public.assignment_room_participants p
            WHERE p.room_id = r.id
              AND p.user_id = v_actor
              AND p.removed_at IS NOT NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.assignment_room_participants p
            WHERE p.room_id = r.id
              AND p.user_id = v_actor
              AND p.removed_at IS NULL
          )
        )
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 20
    ) v
  ), '[]'::jsonb));
END;
$$;

CREATE FUNCTION public.enter_group_assignment_room(
  p_room_id uuid,
  p_member_token text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_participant public.assignment_room_participants%ROWTYPE;
  v_member guest_credentials.assignment_room_members%ROWTYPE;
  v_member_digest bytea;
  v_kind text;
  v_group_id uuid;
  v_display_name text;
  v_active_count integer;
  v_next_ordinal integer;
BEGIN
  IF p_room_id IS NULL
     OR p_member_token IS NULL
     OR p_member_token !~ '^armm1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_actor := public.current_user_id();
  v_member_digest := extensions.digest(convert_to(p_member_token, 'UTF8'), 'sha256');

  SELECT group_target->>'kind', (group_target->>'groupId')::uuid
    INTO v_kind, v_group_id
  FROM public.assignment_rooms
  WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;
  IF v_kind IS DISTINCT FROM 'existing' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;

  -- Removal and exclusion take the groups row FOR UPDATE (lock_group), so a
  -- shared lock here orders this enter against leave/remove before the room
  -- locks, keeping the group-then-room order every writer already uses.
  PERFORM 1 FROM public.groups WHERE id = v_group_id FOR SHARE;

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;
  IF NOT public.is_member(v_group_id, v_actor) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;

  -- A retry that resends the caller's own committed token (lost response,
  -- double tap) resolves to the same view, exactly like the join digest
  -- branch, before the global uniqueness check rejects the digest.
  SELECT m.* INTO v_member
  FROM guest_credentials.assignment_room_members m
  JOIN public.assignment_room_participants p
    ON p.room_id = m.room_id AND p.id = m.participant_id
  WHERE m.room_id = p_room_id
    AND m.token_digest = v_member_digest
    AND p.user_id = v_actor
  FOR UPDATE OF m, p;
  IF FOUND THEN
    SELECT * INTO v_participant
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id AND id = v_member.participant_id
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
      v_actor = v_room.host_user_id
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM guest_credentials.assignment_room_members
    WHERE token_digest = v_member_digest
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT * INTO v_participant
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id
      AND user_id = v_actor
      AND removed_at IS NULL
  FOR UPDATE;
  IF FOUND THEN
    IF v_room.status = 'cancelled' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
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

  -- The host removed this account from the room; membership must not
  -- resurrect a participant the host already released.
  IF EXISTS (
    SELECT 1
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_room.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

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
END;
$$;

REVOKE ALL ON FUNCTION public.list_open_assignment_rooms(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_assignment_rooms(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.enter_group_assignment_room(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enter_group_assignment_room(uuid, text)
  TO authenticated;
