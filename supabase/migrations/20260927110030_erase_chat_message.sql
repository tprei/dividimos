CREATE FUNCTION public.erase_chat_message(p_message_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id uuid;
  v_message jsonb;
BEGIN
  SELECT group_id INTO v_group_id FROM public.chat_messages WHERE id = p_message_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  PERFORM public.lock_group(v_group_id);
  UPDATE public.chat_messages
  SET content = NULL, erased_at = COALESCE(erased_at, now())
  WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  v_message := public.ledger_chat_message_json(p_message_id);
  PERFORM realtime.send(v_message, 'message', 'chat:' || v_group_id::text, true);
  PERFORM realtime.send(jsonb_build_object('group_id', v_group_id),
    'chat_activity', 'group:' || v_group_id::text, true);
  RETURN v_message;
END;
$$;
REVOKE ALL ON FUNCTION public.erase_chat_message(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_chat_message(uuid) TO service_role;
