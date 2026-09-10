CREATE FUNCTION public.send_message(p_client_id uuid, p_group_id uuid, p_content text)
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
$$;

CREATE FUNCTION public.mark_read(p_group_id uuid, p_last_read_message_id uuid)
RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_last_read_at timestamptz;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL OR p_last_read_message_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  SELECT created_at
  INTO v_last_read_at
  FROM chat_messages
  WHERE id = p_last_read_message_id
    AND group_id = p_group_id
    AND sender_id <> v_actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  INSERT INTO conversation_reads (user_id, group_id, last_read_at, last_read_message_id)
  VALUES (v_actor, p_group_id, v_last_read_at, p_last_read_message_id)
  ON CONFLICT (user_id, group_id)
  DO UPDATE
  SET last_read_at = EXCLUDED.last_read_at,
      last_read_message_id = EXCLUDED.last_read_message_id
  WHERE conversation_reads.last_read_message_id IS NULL
     OR (EXCLUDED.last_read_at, EXCLUDED.last_read_message_id)
        > (conversation_reads.last_read_at, conversation_reads.last_read_message_id);
END;
$$;

REVOKE ALL ON FUNCTION public.send_message(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_read(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_read(uuid, uuid) TO authenticated;
