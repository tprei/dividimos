-- Replace the previously applied five-argument settlement RPC with the
-- current six-argument form used by the declarative schema.
DROP FUNCTION IF EXISTS public.record_settlement(uuid, uuid, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.record_settlement(
  p_operation_id uuid,
  p_group_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount_cents integer,
  p_allow_overpay boolean DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_existing RECORD;
  v_settlement_id uuid;
  v_ledger_version bigint;
  v_from_net bigint;
  v_to_net bigint;
  v_event_id bigint;
  v_subject_user_id uuid;
BEGIN
  v_actor := current_user_id();

  IF p_operation_id IS NULL OR p_group_id IS NULL
     OR p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF v_actor <> p_from_user_id AND v_actor <> p_to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_party';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT * INTO v_existing FROM settlements WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.from_user_id <> p_from_user_id OR v_existing.group_id <> p_group_id
       OR v_existing.to_user_id <> p_to_user_id OR v_existing.amount_cents <> p_amount_cents THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    IF v_existing.status = 'voided' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_voided';
    END IF;

    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;
    RETURN jsonb_build_object(
      'settlementId', v_existing.id,
      'groupId', v_existing.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  IF NOT is_member(p_group_id, CASE WHEN v_actor = p_from_user_id THEN p_to_user_id ELSE p_from_user_id END) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'counterparty_not_member';
  END IF;

  SELECT COALESCE((
    SELECT net_cents FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_from_user_id
  ), 0) INTO v_from_net;
  SELECT COALESCE((
    SELECT net_cents FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_to_user_id
  ), 0) INTO v_to_net;

  IF NOT COALESCE(p_allow_overpay, false) THEN
    IF v_from_net >= 0 OR p_amount_cents > -v_from_net
       OR v_to_net <= 0 OR p_amount_cents > v_to_net THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'amount_exceeds_debt';
    END IF;
  END IF;

  INSERT INTO settlements (operation_id, group_id, from_user_id, to_user_id, amount_cents, status, confirmed_at, created_by)
  VALUES (p_operation_id, p_group_id, p_from_user_id, p_to_user_id, p_amount_cents, 'confirmed', now(), v_actor)
  RETURNING id INTO v_settlement_id;

  v_ledger_version := recompute_group_balances(p_group_id);

  v_subject_user_id := CASE WHEN v_actor = p_from_user_id THEN p_to_user_id ELSE p_from_user_id END;

  v_event_id := emit_event(
    p_group_id,
    'settlement_recorded',
    v_actor,
    p_settlement_id => v_settlement_id,
    p_subject_user_id => v_subject_user_id,
    p_payload => jsonb_build_object('amountCents', p_amount_cents, 'fromUserId', p_from_user_id, 'toUserId', p_to_user_id)
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

REVOKE ALL ON FUNCTION public.record_settlement(uuid, uuid, uuid, uuid, integer, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.record_settlement(uuid, uuid, uuid, uuid, integer, boolean) TO authenticated;
