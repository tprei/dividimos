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

  INSERT INTO chat_messages (client_id, group_id, sender_id, content)
  VALUES (p_client_id, p_group_id, v_actor, v_content)
  RETURNING id INTO v_message_id;

  v_result := public.ledger_chat_message_json(v_message_id);

  PERFORM realtime.send(v_result, 'message', 'chat:' || p_group_id::text, true);

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.mark_read(p_group_id uuid)
RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  INSERT INTO conversation_reads (user_id, group_id, last_read_at)
  VALUES (v_actor, p_group_id, now())
  ON CONFLICT (user_id, group_id)
  DO UPDATE SET last_read_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.send_message(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_read(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_read(uuid) TO authenticated;
