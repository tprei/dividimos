CREATE FUNCTION public.send_nudge(
  p_group_id uuid,
  p_user_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_amount_cents bigint;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  IF NOT is_member(p_group_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'counterparty_not_member';
  END IF;

  SELECT amount_cents INTO v_amount_cents
  FROM group_transfers(p_group_id)
  WHERE from_id = p_user_id AND to_id = v_actor;

  IF v_amount_cents IS NULL OR v_amount_cents <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_debt';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_events
    WHERE group_id = p_group_id
      AND kind = 'nudge'
      AND actor_id = v_actor
      AND subject_user_id = p_user_id
      AND created_at > now() - interval '24 hours'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'nudge_cooldown';
  END IF;

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'nudge',
    v_actor,
    p_subject_user_id => p_user_id,
    p_payload => jsonb_build_object('amountCents', v_amount_cents)
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_nudge(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.send_nudge(uuid, uuid) TO authenticated;
