-- 717b: page conversations by paired (created_at, id) cursors.

drop function if exists "public"."get_conversation"(p_group_id uuid, p_before timestamp with time zone, p_limit integer);

drop index if exists "public"."chat_messages_group_idx";

CREATE INDEX chat_messages_group_idx ON public.chat_messages USING btree (group_id, created_at DESC, id DESC);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_conversation(p_group_id uuid, p_message_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_message_before_id uuid DEFAULT NULL::uuid, p_event_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_event_before_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_messages jsonb;
  v_message_cursor jsonb;
  v_messages_complete boolean;
  v_events jsonb;
  v_event_cursor jsonb;
  v_events_complete boolean;
BEGIN
  v_user_id := current_user_id();

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

  PERFORM assert_member(p_group_id, v_user_id);

  -- Each stream reads p_limit + 1 rows: the surplus row proves another page
  -- exists (a full page alone does not), and is dropped before the cursor is
  -- taken from the last row actually returned.
  WITH page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM chat_messages
    WHERE group_id = p_group_id
      AND (
        p_message_before_id IS NULL
        OR (created_at, id) < (p_message_before_created_at, p_message_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(ledger_chat_message_json(p.id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_messages, v_messages_complete, v_message_cursor
  FROM page p;

  WITH page AS (
    SELECT id, created_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM group_events
    WHERE group_id = p_group_id
      AND (
        p_event_before_id IS NULL
        OR (created_at, id) < (p_event_before_created_at, p_event_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(ledger_event_json(p.id) ORDER BY p.created_at DESC, p.id DESC)
      FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
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
      FROM conversation_reads cr
      WHERE cr.user_id = v_user_id
        AND cr.group_id = p_group_id
        AND cr.last_read_message_id IS NOT NULL
    ), 'null'::jsonb)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.send_message(p_client_id uuid, p_group_id uuid, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
BEGIN
  v_actor := current_user_id();

  IF p_client_id IS NULL OR p_group_id IS NULL OR p_content IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_content := trim(p_content);
  IF length(v_content) < 1 OR length(v_content) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  -- Serialise message creation with reads and other chat writers for this group.
  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT id, sender_id, group_id INTO v_existing_id, v_existing_sender, v_existing_group
  FROM chat_messages
  WHERE client_id = p_client_id;

  IF FOUND THEN
    IF v_existing_sender <> v_actor OR v_existing_group <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.ledger_chat_message_json(v_existing_id);
  END IF;

  SELECT GREATEST(
    clock_timestamp(),
    COALESCE(max(created_at) + interval '1 microsecond', '-infinity'::timestamptz)
  )
  INTO v_created_at
  FROM chat_messages
  WHERE group_id = p_group_id;

  -- Concurrent retries of the same client_id must both resolve to one row.
  INSERT INTO chat_messages (client_id, group_id, sender_id, content, created_at)
  VALUES (p_client_id, p_group_id, v_actor, v_content, v_created_at)
  ON CONFLICT (client_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT id, sender_id, group_id INTO v_existing_id, v_existing_sender, v_existing_group
    FROM chat_messages WHERE client_id = p_client_id;
    IF v_existing_sender <> v_actor OR v_existing_group <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.ledger_chat_message_json(v_existing_id);
  END IF;

  v_result := public.ledger_chat_message_json(v_message_id);

  PERFORM realtime.send(v_result, 'message', 'chat:' || p_group_id::text, true);

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
$function$
;



REVOKE ALL ON FUNCTION public.get_conversation(uuid, timestamptz, uuid, timestamptz, bigint, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_conversation(uuid, timestamptz, uuid, timestamptz, bigint, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.send_message(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, uuid, text) TO authenticated;
