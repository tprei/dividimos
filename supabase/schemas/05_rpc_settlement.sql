CREATE FUNCTION public.record_settlement(
  p_operation_id uuid,
  p_group_id uuid,
  p_to_user_id uuid,
  p_amount_cents integer
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_existing RECORD;
  v_settlement_id uuid;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_operation_id IS NULL OR p_group_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_to_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT * INTO v_existing FROM settlements WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.from_user_id <> v_actor OR v_existing.group_id <> p_group_id
       OR v_existing.to_user_id <> p_to_user_id OR v_existing.amount_cents <> p_amount_cents THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;
    RETURN jsonb_build_object(
      'settlementId', v_existing.id,
      'groupId', v_existing.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  IF NOT is_member(p_group_id, p_to_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'counterparty_not_member';
  END IF;

  INSERT INTO settlements (operation_id, group_id, from_user_id, to_user_id, amount_cents, status, created_by)
  VALUES (p_operation_id, p_group_id, v_actor, p_to_user_id, p_amount_cents, 'pending', v_actor)
  RETURNING id INTO v_settlement_id;

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'settlement_recorded',
    v_actor,
    p_settlement_id => v_settlement_id,
    p_subject_user_id => p_to_user_id,
    p_payload => jsonb_build_object('amountCents', p_amount_cents, 'fromUserId', v_actor, 'toUserId', p_to_user_id)
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'settlementId', v_settlement_id,
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.confirm_settlement(p_settlement_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_s RECORD;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_settlement_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_not_found';
  END IF;

  SELECT * INTO v_s FROM settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_not_found';
  END IF;

  PERFORM lock_group(v_s.group_id);

  SELECT * INTO v_s FROM settlements WHERE id = p_settlement_id FOR UPDATE;

  IF v_actor <> v_s.to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_payee';
  END IF;

  IF v_s.status <> 'pending' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_not_pending';
  END IF;

  UPDATE settlements
  SET status = 'confirmed', confirmed_at = now()
  WHERE id = p_settlement_id;

  v_ledger_version := recompute_group_balances(v_s.group_id);

  v_event_id := emit_event(
    v_s.group_id,
    'settlement_confirmed',
    v_actor,
    p_settlement_id => p_settlement_id,
    p_subject_user_id => v_s.from_user_id,
    p_payload => jsonb_build_object('amountCents', v_s.amount_cents, 'fromUserId', v_s.from_user_id, 'toUserId', v_s.to_user_id)
  );

  PERFORM broadcast_group(v_s.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'settlementId', p_settlement_id,
    'groupId', v_s.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.void_settlement(p_settlement_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_s RECORD;
  v_was_confirmed boolean;
  v_ledger_version bigint;
  v_event_id bigint;
  v_other_party uuid;
BEGIN
  v_actor := current_user_id();

  IF p_settlement_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_not_found';
  END IF;

  SELECT * INTO v_s FROM settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_not_found';
  END IF;

  PERFORM lock_group(v_s.group_id);

  SELECT * INTO v_s FROM settlements WHERE id = p_settlement_id FOR UPDATE;

  IF v_actor <> v_s.from_user_id AND v_actor <> v_s.to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_party';
  END IF;

  IF v_s.status = 'voided' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_voided';
  END IF;

  v_was_confirmed := (v_s.status = 'confirmed');

  UPDATE settlements
  SET status = 'voided', voided_at = now(), voided_by = v_actor
  WHERE id = p_settlement_id;

  IF v_was_confirmed THEN
    v_ledger_version := recompute_group_balances(v_s.group_id);
  ELSE
    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_s.group_id;
  END IF;

  v_other_party := CASE WHEN v_actor = v_s.from_user_id THEN v_s.to_user_id ELSE v_s.from_user_id END;

  v_event_id := emit_event(
    v_s.group_id,
    'settlement_voided',
    v_actor,
    p_settlement_id => p_settlement_id,
    p_subject_user_id => v_other_party,
    p_payload => jsonb_build_object(
      'amountCents', v_s.amount_cents,
      'fromUserId', v_s.from_user_id,
      'toUserId', v_s.to_user_id,
      'wasConfirmed', v_was_confirmed
    )
  );

  PERFORM broadcast_group(v_s.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'settlementId', p_settlement_id,
    'groupId', v_s.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_settlement(uuid, uuid, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.record_settlement(uuid, uuid, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_settlement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_settlement(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.void_settlement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.void_settlement(uuid) TO authenticated;
