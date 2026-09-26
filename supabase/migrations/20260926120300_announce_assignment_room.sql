-- The host announces an existing-group room once: `announce_assignment_room`
-- emits the idempotent `assignment_room_opened` group event (payload
-- roomId/title/totalCents) and triggers the "room opened" push to accepted
-- members except the host. The partial index keeps the idempotency probe off
-- the group's full event history while the group lock is held.
SET lock_timeout = '5s';

CREATE INDEX group_events_room_opened_idx
  ON public.group_events (group_id, (payload->>'roomId'))
  WHERE kind = 'assignment_room_opened';

CREATE FUNCTION public.announce_assignment_room(p_room_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_kind text;
  v_group_id uuid;
  v_host uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_event_id bigint;
BEGIN
  v_actor := public.current_user_id();

  SELECT group_target->>'kind', (group_target->>'groupId')::uuid, host_user_id
    INTO v_kind, v_group_id, v_host
  FROM public.assignment_rooms
  WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;
  IF v_kind IS DISTINCT FROM 'existing' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;
  IF v_host <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  PERFORM public.lock_group(v_group_id);

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;
  IF v_room.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;
  PERFORM public.assert_member(v_group_id, v_actor);

  -- Announcing is idempotent: a retry returns the event already emitted for
  -- this room instead of spamming the feed with a second "room opened".
  SELECT id INTO v_event_id
  FROM public.group_events
  WHERE group_id = v_group_id
    AND kind = 'assignment_room_opened'
    AND payload->>'roomId' = p_room_id::text;
  IF FOUND THEN
    RETURN jsonb_build_object('eventId', v_event_id);
  END IF;

  IF v_room.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

  v_event_id := public.emit_event(
    v_group_id,
    'assignment_room_opened',
    v_actor,
    NULL, NULL, NULL,
    jsonb_build_object(
      'roomId', v_room.id,
      'title', v_room.header->>'title',
      'totalCents', (
        SELECT COALESCE(sum(i.total_price_cents), 0)
          + floor((
            COALESCE(sum(i.total_price_cents), 0)::numeric
              * (v_room.header->>'serviceFeeBasisPoints')::integer
            + 5000
          ) / 10000)
          + (v_room.header->>'fixedFeeCents')::integer
        FROM public.assignment_room_items i
        WHERE i.room_id = p_room_id
      )
    )
  );
  PERFORM public.broadcast_group(
    v_group_id,
    (SELECT ledger_version FROM public.groups WHERE id = v_group_id),
    v_event_id
  );
  RETURN jsonb_build_object('eventId', v_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.announce_assignment_room(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.announce_assignment_room(uuid)
  TO authenticated;
