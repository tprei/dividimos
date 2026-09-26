-- create_expense reserved p_client_id globally for expenses while
-- finalize_assignment_room pre-checked expenses.client_id = room id, so anyone
-- who saw a room link could claim the room id as their own expense client id
-- and make the host finalize fail with invalid_operation forever.
CREATE OR REPLACE FUNCTION public.create_expense(p_client_id uuid, p_group_id uuid, p_occurred_on date, p_title text, p_merchant_name text, p_expense_type expense_type, p_total_cents integer, p_service_fee_bps integer, p_fixed_fee_cents integer, p_payload jsonb, p_chave_acesso text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_title text;
  v_payload jsonb;
  v_expense_id uuid;
  v_existing_id uuid;
  v_existing_group_id uuid;
  v_existing_status public.expense_status;
  v_existing_version_no integer;
  v_existing_ledger_version bigint;
  v_ledger_version bigint;
  v_event_id bigint;
  v_constraint text;
BEGIN
  v_actor := current_user_id();


  PERFORM lock_receipt_key(v_actor, p_chave_acesso);
  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  IF EXISTS (
    SELECT 1 FROM public.assignment_rooms r
    WHERE r.id = p_client_id
      AND NOT (r.host_user_id = v_actor AND r.status = 'closed')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT id, group_id, status, current_version_no
    INTO v_existing_id, v_existing_group_id, v_existing_status, v_existing_version_no
  FROM expenses WHERE client_id = p_client_id;
  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status = 'deleted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
    END IF;
    IF v_existing_group_id <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    SELECT ledger_version INTO v_existing_ledger_version FROM groups WHERE id = p_group_id;
    RETURN jsonb_build_object(
      'expenseId', v_existing_id,
      'groupId', p_group_id,
      'versionNo', v_existing_version_no,
      'ledgerVersion', v_existing_ledger_version,
      'eventId', NULL
    );
  END IF;
  IF p_chave_acesso IS NOT NULL AND p_chave_acesso !~ '^[0-9]{44}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_chave_acesso IS NOT NULL AND EXISTS (
    SELECT 1
    FROM expenses
    WHERE creator_id = v_actor
      AND chave_acesso = p_chave_acesso
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
  END IF;

  v_title := btrim(p_title);
  IF v_title IS NULL OR length(v_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_merchant_name IS NOT NULL AND length(btrim(p_merchant_name)) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_occurred_on IS NULL OR p_expense_type IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_total_cents IS NULL OR p_total_cents NOT BETWEEN 1 AND 99999999
     OR p_service_fee_bps IS NULL OR p_service_fee_bps NOT BETWEEN 0 AND 10000
     OR p_fixed_fee_cents IS NULL OR p_fixed_fee_cents NOT BETWEEN 0 AND 99999999
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_payload := validate_expense_payload(p_payload, p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents);

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_payload->'participants') AS pp(p)
    WHERE pp.p->>'kind' = 'user' AND (pp.p->>'userId')::uuid = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'creator_not_participant';
  END IF;

  BEGIN
    INSERT INTO expenses (client_id, group_id, creator_id, chave_acesso)
    VALUES (p_client_id, p_group_id, v_actor, p_chave_acesso)
    RETURNING id INTO v_expense_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'expenses_creator_chave_active_idx' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END;

  v_payload := resolve_expense_participants(v_expense_id, v_payload);

  -- Shared-history latch: the new expense becomes visible to more than one
  -- user when a second accepted member can read it or the payload names
  -- another invited/accepted user.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = p_group_id
    AND financial_history_shared_at IS NULL
    AND (
      (SELECT count(*) FROM public.group_members
       WHERE group_id = p_group_id AND status = 'accepted') > 1
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_payload->'participants') AS pp(p)
        WHERE pp.p->>'kind' = 'user'
          AND (pp.p->>'userId')::uuid IS DISTINCT FROM v_actor
          AND EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = p_group_id
              AND gm.user_id = (pp.p->>'userId')::uuid
              AND gm.status IN ('invited', 'accepted')
          )
      )
    );

  INSERT INTO expense_versions (
    expense_id, version_no, author_id, occurred_on, title, merchant_name, expense_type,
    total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
  ) VALUES (
    v_expense_id, 1, v_actor, p_occurred_on, v_title, btrim(p_merchant_name), p_expense_type,
    p_total_cents, p_service_fee_bps, p_fixed_fee_cents, v_payload, NULL
  );

  v_ledger_version := recompute_group_balances(p_group_id);
  v_event_id := emit_event(
    p_group_id, 'expense_created', v_actor, v_expense_id,
    NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', p_total_cents)
  );
  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_expense_id,
    'groupId', p_group_id,
    'versionNo', 1,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb, text)
  TO service_role, authenticated;
