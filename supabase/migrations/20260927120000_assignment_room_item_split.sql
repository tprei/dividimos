CREATE FUNCTION public.set_assignment_room_item_claims(
  p_room_id uuid,
  p_item_id uuid,
  p_expected_item_revision bigint,
  p_claims jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_room public.assignment_rooms%ROWTYPE;
  v_item public.assignment_room_items%ROWTYPE;
  v_host_participant_id uuid;
  v_entry jsonb;
  v_index integer;
  v_participant_id uuid;
  v_ticks numeric;
  v_participant_ids uuid[] := ARRAY[]::uuid[];
  v_new_ticks bigint[] := ARRAY[]::bigint[];
  v_current_ticks bigint;
  v_changed boolean := false;
  v_total_ticks bigint;
  v_capacity bigint;
BEGIN
  IF p_room_id IS NULL OR p_item_id IS NULL
     OR p_expected_item_revision IS NULL OR p_expected_item_revision < 1
     OR p_claims IS NULL OR jsonb_typeof(p_claims) <> 'array'
     OR jsonb_array_length(p_claims) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  FOR v_index IN 0..jsonb_array_length(p_claims) - 1 LOOP
    v_entry := p_claims -> v_index;
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry -> 'participantId') IS DISTINCT FROM 'string'
       OR COALESCE(v_entry ->> 'participantId', '')
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_entry -> 'ticks') IS DISTINCT FROM 'number'
       OR COALESCE(v_entry ->> 'ticks', '') !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_ticks := (v_entry ->> 'ticks')::numeric;
    IF v_ticks > 119999999880 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_participant_id := (v_entry ->> 'participantId')::uuid;
    IF v_participant_id = ANY (v_participant_ids) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_participant_ids := array_append(v_participant_ids, v_participant_id);
    v_new_ticks := array_append(v_new_ticks, v_ticks::bigint);
  END LOOP;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
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

  IF v_room.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
  END IF;
  IF v_room.status = 'finalized' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

  SELECT * INTO v_item
  FROM public.assignment_room_items
  WHERE room_id = p_room_id AND id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'item_unavailable';
  END IF;

  PERFORM 1
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id
    AND id = ANY (v_participant_ids)
    AND removed_at IS NULL
  ORDER BY id
  FOR UPDATE;
  IF (
    SELECT count(*)
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id
      AND id = ANY (v_participant_ids)
      AND removed_at IS NULL
  ) <> cardinality(v_participant_ids)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;

  PERFORM 1
  FROM public.assignment_room_claims
  WHERE room_id = p_room_id AND item_id = p_item_id
  FOR UPDATE;

  FOR v_index IN 1..cardinality(v_participant_ids) LOOP
    SELECT ticks INTO v_current_ticks
    FROM public.assignment_room_claims
    WHERE room_id = p_room_id
      AND item_id = p_item_id
      AND participant_id = v_participant_ids[v_index];
    IF COALESCE(v_current_ticks, 0) <> v_new_ticks[v_index] THEN
      v_changed := true;
    END IF;
  END LOOP;
  IF NOT v_changed THEN
    RETURN public.assignment_room_view(
      p_room_id,
      v_host_participant_id,
      true
    );
  END IF;

  IF v_item.revision <> p_expected_item_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  SELECT COALESCE(sum(
    CASE
      WHEN p.id = ANY (v_participant_ids)
        THEN v_new_ticks[array_position(v_participant_ids, p.id)]
      ELSE COALESCE(c.ticks, 0)
    END
  ), 0)
  INTO v_total_ticks
  FROM public.assignment_room_participants p
  LEFT JOIN public.assignment_room_claims c
    ON c.room_id = p.room_id
   AND c.item_id = p_item_id
   AND c.participant_id = p.id
  WHERE p.room_id = p_room_id
    AND p.removed_at IS NULL;

  v_capacity := v_item.quantity_milliunits::bigint * 120;
  IF v_total_ticks > v_capacity THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'item_unavailable';
  END IF;

  FOR v_index IN 1..cardinality(v_participant_ids) LOOP
    IF v_new_ticks[v_index] = 0 THEN
      DELETE FROM public.assignment_room_claims
      WHERE room_id = p_room_id
        AND item_id = p_item_id
        AND participant_id = v_participant_ids[v_index];
    ELSE
      INSERT INTO public.assignment_room_claims (
        room_id, item_id, participant_id, ticks
      ) VALUES (
        p_room_id, p_item_id, v_participant_ids[v_index], v_new_ticks[v_index]
      )
      ON CONFLICT (room_id, item_id, participant_id) DO UPDATE
      SET ticks = EXCLUDED.ticks;
    END IF;
  END LOOP;

  UPDATE public.assignment_room_items
  SET revision = revision + 1
  WHERE room_id = p_room_id AND id = p_item_id;
  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE id = p_room_id;

  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN public.assignment_room_view(
    p_room_id,
    v_host_participant_id,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_assignment_room_item_claims(uuid, uuid, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_assignment_room_item_claims(uuid, uuid, bigint, jsonb)
  TO authenticated;
