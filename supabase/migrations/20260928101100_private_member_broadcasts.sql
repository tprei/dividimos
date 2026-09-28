CREATE OR REPLACE FUNCTION public.send_message(p_client_id uuid, p_group_id uuid, p_content text)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
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

  FOR v_rec IN
    SELECT gm.user_id
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.status = 'accepted'
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
$$;

REVOKE ALL ON FUNCTION public.send_message(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, uuid, text) TO authenticated;

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
  v_rec record;
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

  v_summary := public.assignment_room_summary_json(p_room_id);
  IF v_summary->>'groupId' IS NOT NULL THEN
    FOR v_rec IN
      SELECT gm.user_id
      FROM public.group_members gm
      WHERE gm.group_id = (v_summary->>'groupId')::uuid
        AND gm.status = 'accepted'
      FOR SHARE OF gm
    LOOP
      PERFORM realtime.send(
        jsonb_build_object('room', v_summary),
        'assignment_room',
        'user:' || v_rec.user_id::text,
        true
      );
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  TO service_role;
