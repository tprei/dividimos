-- Live room progress for existing-group rooms. `assignment_room_summary_json`
-- is the single shared wire shape (status, revision, total, item progress,
-- claimer avatars) reused by three consumers: the `list_open_assignment_rooms`
-- entries, the `assignment_room` group-topic broadcast that `broadcast_assignment_room`
-- now emits on every room mutation, and the `assignmentRoom` key that the new
-- `get_conversation_v2` attaches to `assignment_room_opened` events. v1
-- `get_conversation` stays byte-identical for installed builds.
CREATE FUNCTION public.assignment_room_summary_json(p_room_id uuid)
RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN r.group_target->>'kind' IS DISTINCT FROM 'existing' THEN NULL
    ELSE jsonb_build_object(
      'id', r.id,
      'groupId', (r.group_target->>'groupId')::uuid,
      'status', r.status,
      'revision', r.revision,
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
      'itemCount', (
        SELECT count(*) FROM public.assignment_room_items i WHERE i.room_id = r.id
      ),
      'ownedItemCount', (
        SELECT count(*)
        FROM public.assignment_room_items i
        WHERE i.room_id = r.id
          AND COALESCE((
            SELECT sum(c.ticks)
            FROM public.assignment_room_claims c
            JOIN public.assignment_room_participants p
              ON p.room_id = c.room_id AND p.id = c.participant_id
            WHERE c.room_id = i.room_id
              AND c.item_id = i.id
              AND p.removed_at IS NULL
          ), 0) = i.quantity_milliunits::bigint * 120
      ),
      'claimers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'participantId', p.id,
          'userId', p.user_id,
          'name', p.display_name,
          'avatarUrl', u.avatar_url
        ) ORDER BY p.ordinal)
        FROM public.assignment_room_participants p
        LEFT JOIN public.users u ON u.id = p.user_id
        WHERE p.room_id = r.id
          AND p.removed_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM public.assignment_room_claims c
            WHERE c.room_id = r.id
              AND c.participant_id = p.id
          )
      ), '[]'::jsonb),
      'expenseId', r.expense_id
    )
  END
  FROM public.assignment_rooms r
  WHERE r.id = p_room_id
$$;

REVOKE ALL ON FUNCTION public.assignment_room_summary_json(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_room_summary_json(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_open_assignment_rooms(p_group_id uuid)
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
      SELECT public.assignment_room_summary_json(r.id)
             || jsonb_build_object('joined', EXISTS (
                 SELECT 1
                 FROM public.assignment_room_participants p
                 WHERE p.room_id = r.id
                   AND p.user_id = v_actor
                   AND p.removed_at IS NULL
               )) AS room,
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

CREATE OR REPLACE FUNCTION public.broadcast_assignment_room(
  p_room_id uuid,
  p_event text DEFAULT 'assignment',
  p_topic text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_revision bigint;
  v_topic text;
  v_current_topic text;
  v_summary jsonb;
BEGIN
  SELECT r.revision, a.broadcast_topic
  INTO v_revision, v_current_topic
  FROM public.assignment_rooms r
  JOIN guest_credentials.assignment_room_access a ON a.room_id = r.id
  WHERE r.id = p_room_id;

  IF NOT FOUND OR v_current_topic IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;

  v_topic := COALESCE(p_topic, v_current_topic);
  PERFORM realtime.send(
    jsonb_build_object('revision', v_revision),
    CASE WHEN p_event = 'access_changed' THEN 'access_changed' ELSE 'assignment' END,
    v_topic,
    true
  );

  IF p_event = 'access_changed' AND v_topic <> v_current_topic THEN
    PERFORM realtime.send(
      jsonb_build_object('revision', v_revision),
      'assignment',
      v_current_topic,
      true
    );
  END IF;

  -- Every room mutation funnels through here, so this one send carries the
  -- live summary to every accepted member of the target group; installed
  -- builds ignore the unknown event name on the group topic.
  v_summary := public.assignment_room_summary_json(p_room_id);
  IF v_summary IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('room', v_summary),
      'assignment_room',
      'group:' || (v_summary->>'groupId'),
      true
    );
  END IF;
END;
$$;

CREATE FUNCTION public.get_conversation_v2(
  p_group_id uuid,
  p_message_before_created_at timestamptz DEFAULT NULL,
  p_message_before_id uuid DEFAULT NULL,
  p_event_before_created_at timestamptz DEFAULT NULL,
  p_event_before_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_messages jsonb;
  v_message_cursor jsonb;
  v_messages_complete boolean;
  v_events jsonb;
  v_event_cursor jsonb;
  v_events_complete boolean;
BEGIN
  v_user_id := public.current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  -- A half-specified cursor cannot express the strict (created_at, id)
  -- boundary, so accepting one half would skip or repeat rows sharing a
  -- timestamp.
  IF (p_message_before_created_at IS NULL) <> (p_message_before_id IS NULL)
     OR (p_event_before_created_at IS NULL) <> (p_event_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM public.assert_member(p_group_id, v_user_id);

  -- Each stream reads p_limit + 1 rows: the surplus row proves another page
  -- exists (a full page alone does not), and is dropped before the cursor is
  -- taken from the last row actually returned.
  WITH page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM public.chat_messages
    WHERE group_id = p_group_id
      AND (
        p_message_before_id IS NULL
        OR (created_at, id) < (p_message_before_created_at, p_message_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(public.ledger_chat_message_json(p.id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_messages, v_messages_complete, v_message_cursor
  FROM page p;

  -- Unlike v1, the room-opened event is served here, and only that kind
  -- carries the extra `assignmentRoom` summary plus the caller's own
  -- `assignmentRoomAccess` ('joined', 'removed', or 'none'), which the
  -- group-wide summary and broadcast cannot express. Every other event is
  -- byte-identical to v1. A payload roomId that is not a uuid yields a null
  -- summary instead of failing the whole page.
  WITH page AS (
    SELECT id, created_at, kind,
      CASE
        WHEN kind = 'assignment_room_opened'
         AND payload->>'roomId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (payload->>'roomId')::uuid
      END AS room_id,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM public.group_events
    WHERE group_id = p_group_id
      AND (
        p_event_before_id IS NULL
        OR (created_at, id) < (p_event_before_created_at, p_event_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(
      CASE WHEN p.kind = 'assignment_room_opened' THEN
        public.ledger_event_json(p.id) || jsonb_build_object(
          'assignmentRoom',
          public.assignment_room_summary_json(p.room_id),
          'assignmentRoomAccess',
          CASE
            WHEN EXISTS (
              SELECT 1 FROM public.assignment_room_participants ap
              WHERE ap.room_id = p.room_id
                AND ap.user_id = v_user_id
                AND ap.removed_at IS NULL
            ) THEN 'joined'
            WHEN EXISTS (
              SELECT 1 FROM public.assignment_room_participants ap
              WHERE ap.room_id = p.room_id
                AND ap.user_id = v_user_id
            ) THEN 'removed'
            ELSE 'none'
          END
        )
      ELSE
        public.ledger_event_json(p.id)
      END
      ORDER BY p.created_at DESC, p.id DESC
    ) FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_events, v_events_complete, v_event_cursor
  FROM page p;

  RETURN jsonb_build_object(
    'messages', v_messages,
    'messageCursor', v_message_cursor,
    'messagesComplete', v_messages_complete,
    'events', v_events,
    'eventCursor', v_event_cursor,
    'eventsComplete', v_events_complete,
    'readWatermark', COALESCE((
      SELECT jsonb_build_object(
        'lastReadAt', to_jsonb(cr.last_read_at),
        'lastReadMessageId', cr.last_read_message_id
      )
      FROM public.conversation_reads cr
      WHERE cr.user_id = v_user_id
        AND cr.group_id = p_group_id
        AND cr.last_read_message_id IS NOT NULL
    ), 'null'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_open_assignment_rooms(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_assignment_rooms(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.get_conversation_v2(uuid, timestamptz, uuid, timestamptz, bigint, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_v2(uuid, timestamptz, uuid, timestamptz, bigint, integer)
  TO authenticated;
