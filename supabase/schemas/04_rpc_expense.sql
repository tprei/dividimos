CREATE FUNCTION public.create_expense(
  p_client_id uuid, p_group_id uuid, p_occurred_on date,
  p_title text, p_merchant_name text, p_expense_type expense_type,
  p_total_cents integer, p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb, p_chave_acesso text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
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
    INSERT INTO expenses (client_id, group_id, creator_id, occurred_on, chave_acesso)
    VALUES (p_client_id, p_group_id, v_actor, p_occurred_on, p_chave_acesso)
    RETURNING id INTO v_expense_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'expenses_creator_chave_active_idx' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END;

  v_payload := materialize_participants(v_expense_id, v_actor, v_payload);

  INSERT INTO expense_versions (
    expense_id, version_no, author_id, title, merchant_name, expense_type,
    total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
  ) VALUES (
    v_expense_id, 1, v_actor, v_title, btrim(p_merchant_name), p_expense_type,
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
$$;

CREATE FUNCTION public.edit_expense(
  p_expense_id uuid, p_expected_version_no integer,
  p_occurred_on date, p_title text, p_merchant_name text, p_expense_type expense_type,
  p_total_cents integer, p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_creator_id uuid;
  v_status public.expense_status;
  v_current_version_no integer;
  v_new_version_no integer;
  v_title text;
  v_payload jsonb;
  v_change_summary jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;

  PERFORM lock_group(v_group_id);
  PERFORM assert_member(v_group_id, v_actor);

  -- Re-read under the lock: an unlocked read lets two racing edits both pass
  -- the version check and collide on expense_versions_pkey.
  SELECT status, current_version_no, creator_id
    INTO v_status, v_current_version_no, v_creator_id
  FROM expenses WHERE id = p_expense_id;

  IF v_creator_id IS DISTINCT FROM v_actor AND NOT EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = p_expense_id AND kind = 'user' AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;
  IF p_expected_version_no IS NULL OR v_current_version_no <> p_expected_version_no THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  v_title := btrim(p_title);
  IF v_title IS NULL OR length(v_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_merchant_name IS NOT NULL AND length(btrim(p_merchant_name)) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_occurred_on IS NULL OR p_expense_type IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_total_cents IS NULL OR p_total_cents NOT BETWEEN 1 AND 99999999
     OR p_service_fee_bps IS NULL OR p_service_fee_bps NOT BETWEEN 0 AND 10000
     OR p_fixed_fee_cents IS NULL OR p_fixed_fee_cents NOT BETWEEN 0 AND 99999999
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_payload := validate_expense_payload(p_payload, p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents);

  v_new_version_no := v_current_version_no + 1;
  v_payload := materialize_participants(p_expense_id, v_actor, v_payload);

  INSERT INTO expense_versions (
    expense_id, version_no, author_id, title, merchant_name, expense_type,
    total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
  ) VALUES (
    p_expense_id, v_new_version_no, v_actor, v_title, btrim(p_merchant_name), p_expense_type,
    p_total_cents, p_service_fee_bps, p_fixed_fee_cents, v_payload, NULL
  );

  v_change_summary := expense_change_summary(p_expense_id, v_current_version_no, v_new_version_no);
  UPDATE expense_versions SET change_summary = v_change_summary
  WHERE expense_id = p_expense_id AND version_no = v_new_version_no;

  UPDATE expenses SET occurred_on = p_occurred_on, current_version_no = v_new_version_no
  WHERE id = p_expense_id;

  v_ledger_version := recompute_group_balances(v_group_id);
  v_event_id := emit_event(v_group_id, 'expense_edited', v_actor, p_expense_id, NULL, NULL, v_change_summary);
  PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'groupId', v_group_id,
    'versionNo', v_new_version_no,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.delete_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_creator_id uuid;
  v_chave_acesso text;
  v_status public.expense_status;
  v_version_no integer;
  v_title text;
  v_total_cents integer;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  SELECT group_id, creator_id, chave_acesso
    INTO v_group_id, v_creator_id, v_chave_acesso
  FROM expenses
  WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;

  PERFORM lock_receipt_key(v_creator_id, v_chave_acesso);
  PERFORM lock_group(v_group_id);
  PERFORM assert_member(v_group_id, v_actor);

  SELECT status, current_version_no, creator_id, chave_acesso
    INTO v_status, v_version_no, v_creator_id, v_chave_acesso
  FROM expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF v_creator_id IS DISTINCT FROM v_actor AND NOT EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = p_expense_id AND kind = 'user' AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  UPDATE expenses SET status = 'deleted', deleted_at = now(), deleted_by = v_actor
  WHERE id = p_expense_id;
  DELETE FROM expense_participants WHERE expense_id = p_expense_id;

  SELECT title, total_cents INTO v_title, v_total_cents
  FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_version_no;

  v_ledger_version := recompute_group_balances(v_group_id);
  v_event_id := emit_event(
    v_group_id, 'expense_deleted', v_actor, p_expense_id,
    NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', v_total_cents)
  );
  PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'groupId', v_group_id,
    'versionNo', v_version_no,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.restore_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_creator_id uuid;
  v_chave_acesso text;
  v_status public.expense_status;
  v_version_no integer;
  v_title text;
  v_total_cents integer;
  v_payload jsonb;
  v_materialized jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
  v_constraint text;
BEGIN
  v_actor := current_user_id();

  SELECT group_id, creator_id, chave_acesso
    INTO v_group_id, v_creator_id, v_chave_acesso
  FROM expenses
  WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;

  PERFORM lock_receipt_key(v_creator_id, v_chave_acesso);
  PERFORM lock_group(v_group_id);
  PERFORM assert_member(v_group_id, v_actor);

  SELECT status, current_version_no, creator_id, chave_acesso
    INTO v_status, v_version_no, v_creator_id, v_chave_acesso
  FROM expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  SELECT payload, title, total_cents INTO v_payload, v_title, v_total_cents
  FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_version_no;

  IF v_creator_id IS DISTINCT FROM v_actor AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_payload->'participants', '[]'::jsonb)) AS pp(p)
    WHERE pp.p->>'kind' = 'user' AND pp.p ? 'userId'
      AND pp.p->>'userId' = v_actor::text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_deleted';
  END IF;

  IF v_chave_acesso IS NOT NULL AND EXISTS (
    SELECT 1
    FROM expenses
    WHERE creator_id = v_creator_id
      AND chave_acesso = v_chave_acesso
      AND status = 'active'
      AND id <> p_expense_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
  END IF;

  BEGIN
    UPDATE expenses SET status = 'active', deleted_at = NULL, deleted_by = NULL
    WHERE id = p_expense_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'expenses_creator_chave_active_idx' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
      END IF;
      RAISE;
  END;

  v_materialized := materialize_participants(p_expense_id, v_actor, v_payload);
  IF v_materialized IS DISTINCT FROM v_payload THEN
    UPDATE expense_versions SET payload = v_materialized
    WHERE expense_id = p_expense_id AND version_no = v_version_no;
  END IF;

  v_ledger_version := recompute_group_balances(v_group_id);
  v_event_id := emit_event(
    v_group_id, 'expense_restored', v_actor, p_expense_id,
    NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', v_total_cents)
  );
  PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'groupId', v_group_id,
    'versionNo', v_version_no,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.restore_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_expense(uuid) TO authenticated;

-- Creates a group and its first expense in one transaction.
--
-- The wizard used to commit the group when the user left the participants
-- step and the expense later at submit. An error or an abandoned wizard in
-- between left a group with invited members and no bill, which is visible to
-- everyone invited. Both writes now succeed or neither does.
--
-- Idempotency is keyed on the expense's client id and checked before anything
-- is written, so a retry after a lost response returns the original pair
-- instead of creating a second group.
CREATE FUNCTION public.create_expense_with_group(
  p_client_id uuid, p_group_name text, p_member_ids uuid[],
  p_occurred_on date, p_title text, p_merchant_name text,
  p_expense_type expense_type, p_total_cents integer,
  p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb, p_chave_acesso text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_existing_id uuid;
  v_existing_group_id uuid;
  v_existing_status public.expense_status;
  v_existing_version_no integer;
  v_existing_ledger_version bigint;
  v_group jsonb;
  v_group_id uuid;
BEGIN
  v_actor := current_user_id();

  SELECT id, group_id, status, current_version_no
    INTO v_existing_id, v_existing_group_id, v_existing_status, v_existing_version_no
  FROM expenses WHERE client_id = p_client_id;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status = 'deleted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
    END IF;
    -- A replay must belong to the caller; another member's expense is not
    -- theirs to read back.
    PERFORM assert_member(v_existing_group_id, v_actor);
    SELECT ledger_version INTO v_existing_ledger_version
    FROM groups WHERE id = v_existing_group_id;
    RETURN jsonb_build_object(
      'expenseId', v_existing_id,
      'groupId', v_existing_group_id,
      'versionNo', v_existing_version_no,
      'ledgerVersion', v_existing_ledger_version,
      'eventId', NULL
    );
  END IF;

  v_group := create_group(p_group_name, p_member_ids);
  v_group_id := (v_group->>'groupId')::uuid;

  RETURN create_expense(
    p_client_id, v_group_id, p_occurred_on, p_title, p_merchant_name,
    p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents,
    p_payload, p_chave_acesso
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense_with_group(uuid, text, uuid[], date, text, text, expense_type, integer, integer, integer, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_expense_with_group(uuid, text, uuid[], date, text, text, expense_type, integer, integer, integer, jsonb, text) TO authenticated;
