-- P11: Remove participant projection and cut over to resolver

CREATE OR REPLACE FUNCTION public.resolve_expense_participants(p_expense_id uuid, p_payload jsonb)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_current_version integer;
  v_prev_payload jsonb;
  v_existing_user_ids uuid[] := '{}';
  v_participants jsonb;
  v_n integer;
  v_i integer;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_id uuid;
  v_new_guest_id uuid;
  v_claimed_by uuid;
  v_claimed_version_no integer;
  v_display_name text;
  v_out_participants jsonb := '[]'::jsonb;
  v_out jsonb;
  v_seen_users uuid[] := '{}';
  v_kept_guest_ids uuid[] := '{}';
BEGIN
  SELECT e.group_id, e.current_version_no INTO v_group_id, v_current_version
  FROM expenses e WHERE e.id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  v_prev_payload := effective_expense_payload(p_expense_id, v_current_version);
  SELECT COALESCE(array_agg((pa.el->>'userId')::uuid), '{}') INTO v_existing_user_ids
  FROM jsonb_array_elements(COALESCE(v_prev_payload->'participants', '[]'::jsonb)) AS pa(el)
  WHERE pa.el->>'kind' = 'user' AND pa.el ? 'userId';

  v_participants := p_payload->'participants';
  IF v_participants IS NULL OR jsonb_typeof(v_participants) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_n := jsonb_array_length(v_participants);
  IF v_n = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_user_id := NULL;
    v_guest_id := NULL;
    v_new_guest_id := NULL;
    v_claimed_by := NULL;
    v_claimed_version_no := NULL;
    v_display_name := NULL;

    IF v_participant->>'kind' = 'user' THEN
      v_user_id := (v_participant->>'userId')::uuid;
      PERFORM assert_dm_pair_allowed(v_group_id, v_user_id);
      IF NOT is_member_or_invited(v_group_id, v_user_id)
         AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
      END IF;
    ELSIF v_participant->>'kind' = 'guest' THEN
      v_display_name := v_participant->>'displayName';
      IF jsonb_typeof(v_participant->'guestId') = 'string' THEN
        v_guest_id := (v_participant->>'guestId')::uuid;
        SELECT id, claimed_by, claimed_version_no INTO v_new_guest_id, v_claimed_by, v_claimed_version_no
        FROM guests WHERE id = v_guest_id AND expense_id = p_expense_id;
        IF v_new_guest_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
        END IF;
      ELSE
        INSERT INTO guests (expense_id, display_name) VALUES (p_expense_id, v_display_name)
        RETURNING id INTO v_new_guest_id;
      END IF;

      IF v_claimed_by IS NOT NULL AND v_claimed_version_no = v_current_version THEN
        v_guest_id := NULL;
        v_user_id := v_claimed_by;
        PERFORM assert_dm_pair_allowed(v_group_id, v_user_id);
        IF NOT is_member_or_invited(v_group_id, v_user_id)
           AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
        END IF;
      ELSE
        v_guest_id := v_new_guest_id;
        v_kept_guest_ids := array_append(v_kept_guest_ids, v_guest_id);
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;

    IF v_user_id IS NOT NULL THEN
      IF v_user_id = ANY (v_seen_users) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
      END IF;
      v_seen_users := array_append(v_seen_users, v_user_id);
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'user', 'userId', v_user_id);
    ELSE
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'guest', 'guestId', v_guest_id, 'displayName', v_display_name);
    END IF;

    v_i := v_i + 1;
  END LOOP;

  DELETE FROM guests g
  WHERE g.expense_id = p_expense_id
    AND g.claimed_by IS NULL
    AND NOT (g.id = ANY (v_kept_guest_ids));

  v_out := jsonb_set(p_payload, '{participants}', v_out_participants);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_expense_participants(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_expense_participants(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_expense(
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
REVOKE ALL ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_expense(
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
    SELECT 1 FROM current_expense_participants
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
  v_payload := resolve_expense_participants(p_expense_id, v_payload);

  -- Shared-history latch: the new version becomes visible to more than one
  -- user when a second accepted member can read it or the payload names
  -- another invited/accepted user.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_group_id
    AND financial_history_shared_at IS NULL
    AND (
      (SELECT count(*) FROM public.group_members
       WHERE group_id = v_group_id AND status = 'accepted') > 1
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_payload->'participants') AS pp(p)
        WHERE pp.p->>'kind' = 'user'
          AND (pp.p->>'userId')::uuid IS DISTINCT FROM v_actor
          AND EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = v_group_id
              AND gm.user_id = (pp.p->>'userId')::uuid
              AND gm.status IN ('invited', 'accepted')
          )
      )
    );

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
REVOKE ALL ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id uuid) RETURNS jsonb
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
    SELECT 1 FROM current_expense_participants
    WHERE expense_id = p_expense_id AND kind = 'user' AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  UPDATE expenses SET status = 'deleted', deleted_at = now(), deleted_by = v_actor
  WHERE id = p_expense_id;

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
REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_expense(p_expense_id uuid) RETURNS jsonb
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
  v_declined_user_ids uuid[];
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

  SELECT status, current_version_no, creator_id, chave_acesso, declined_user_ids
    INTO v_status, v_version_no, v_creator_id, v_chave_acesso, v_declined_user_ids
  FROM expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  SELECT title, total_cents INTO v_title, v_total_cents
  FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_version_no;

  v_payload := effective_expense_payload(p_expense_id, v_version_no);

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

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(v_declined_user_ids, '{}'::uuid[])) AS d(user_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM group_members gm
      WHERE gm.group_id = v_group_id
        AND gm.user_id = d.user_id
        AND gm.status = 'accepted'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invitation_not_accepted';
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
    UPDATE expenses
    SET status = 'active',
        deleted_at = NULL,
        deleted_by = NULL,
        declined_user_ids = '{}'::uuid[]
    WHERE id = p_expense_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'expenses_creator_chave_active_idx' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
      END IF;
      RAISE;
  END;

  v_materialized := resolve_expense_participants(p_expense_id, v_payload);

  -- Shared-history latch: the restored expense becomes visible to more than
  -- one user when a second accepted member can read it or the payload names
  -- another invited/accepted user.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_group_id
    AND financial_history_shared_at IS NULL
    AND (
      (SELECT count(*) FROM public.group_members
       WHERE group_id = v_group_id AND status = 'accepted') > 1
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_materialized->'participants') AS pp(p)
        WHERE pp.p->>'kind' = 'user'
          AND (pp.p->>'userId')::uuid IS DISTINCT FROM v_actor
          AND EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = v_group_id
              AND gm.user_id = (pp.p->>'userId')::uuid
              AND gm.status IN ('invited', 'accepted')
          )
      )
    );

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
REVOKE ALL ON FUNCTION public.restore_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_expense(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind group_kind;
  v_event_id bigint;
  v_invalidated boolean := false;
  v_rec record;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = p_group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  SELECT kind, ledger_version INTO v_kind, v_ledger_version FROM groups WHERE id = p_group_id;

  IF v_kind = 'dm' THEN
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
    DELETE FROM groups WHERE id = p_group_id;
  ELSE
    FOR v_rec IN
      SELECT
        e.id AS expense_id,
        e.status AS expense_status,
        e.declined_user_ids,
        ev.title,
        ev.total_cents
      FROM expenses e
      JOIN expense_versions ev
        ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
      WHERE e.group_id = p_group_id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(effective_expense_payload(e.id, e.current_version_no)->'participants', '[]'::jsonb)) AS pp(p)
          WHERE pp.p->>'kind' = 'user'
            AND pp.p ? 'userId'
            AND pp.p->>'userId' = v_actor::text
        )
      FOR UPDATE OF e
    LOOP
      IF v_rec.expense_status = 'active' THEN
        UPDATE expenses
        SET status = 'deleted',
            deleted_at = now(),
            deleted_by = v_actor,
            declined_user_ids = CASE
              WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
              ELSE array_append(declined_user_ids, v_actor)
            END
        WHERE id = v_rec.expense_id;


        v_event_id := emit_event(
          p_group_id, 'expense_deleted', v_actor, v_rec.expense_id,
          NULL, NULL, jsonb_build_object('title', v_rec.title, 'totalCents', v_rec.total_cents)
        );
        v_invalidated := true;
      ELSE
        UPDATE expenses
        SET declined_user_ids = CASE
              WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
              ELSE array_append(declined_user_ids, v_actor)
            END
        WHERE id = v_rec.expense_id;
      END IF;
    END LOOP;

    IF v_invalidated THEN
      v_ledger_version := recompute_group_balances(p_group_id);
      PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
    END IF;

    DELETE FROM group_members
    WHERE group_id = p_group_id AND user_id = v_actor;
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_guest_claim_token(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_digest bytea;
  v_rec RECORD;
  v_status text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object(
      'guestId', NULL,
      'displayName', NULL,
      'expenseTitle', NULL,
      'groupName', NULL,
      'shareCents', NULL,
      'status', 'not_found'
    );
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'utf8'), 'sha256');

  SELECT
    g.id AS guest_id,
    g.display_name,
    g.claimed_by,
    ev.title AS expense_title,
    grp.name AS group_name,
    COALESCE(ep.share_cents, 0) AS share_cents
  INTO v_rec
  FROM guest_credentials.claim_tokens ct
  JOIN guests g ON g.id = ct.guest_id
  JOIN expenses e ON e.id = g.expense_id
  JOIN expense_versions ev ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
  JOIN groups grp ON grp.id = e.group_id
  LEFT JOIN current_expense_participants ep ON ep.expense_id = e.id AND ep.guest_id = g.id
  WHERE ct.token_digest = v_digest AND ct.expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'guestId', NULL,
      'displayName', NULL,
      'expenseTitle', NULL,
      'groupName', NULL,
      'shareCents', NULL,
      'status', 'not_found'
    );
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    v_status := 'already_claimed';
  ELSE
    v_status := 'ready';
  END IF;

  RETURN jsonb_build_object(
    'guestId', v_rec.guest_id,
    'displayName', v_rec.display_name,
    'expenseTitle', v_rec.expense_title,
    'groupName', v_rec.group_name,
    'shareCents', v_rec.share_cents,
    'status', v_status
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'guestId', NULL,
    'displayName', NULL,
    'expenseTitle', NULL,
    'groupName', NULL,
    'shareCents', NULL,
    'status', 'not_found'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_guest_claim_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_guest_claim_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_guest(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_digest bytea;
  v_group_id uuid;
  v_guest_id uuid;
  v_rec RECORD;
  v_cred RECORD;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'utf8'), 'sha256');

  SELECT ct.guest_id, e.group_id
  INTO v_guest_id, v_group_id
  FROM guest_credentials.claim_tokens ct
  JOIN guests g ON g.id = ct.guest_id
  JOIN expenses e ON e.id = g.expense_id
  WHERE ct.token_digest = v_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  PERFORM lock_group(v_group_id);

  SELECT g.id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = v_guest_id
  FOR UPDATE OF g, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT ct.guest_id, ct.expires_at
  INTO v_cred
  FROM guest_credentials.claim_tokens ct
  WHERE ct.guest_id = v_rec.id AND ct.token_digest = v_digest
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_cred.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_claimed';
  END IF;

  IF v_rec.expense_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  -- A guest dropped by a later edit keeps its row but no participant slot;
  -- redeeming that orphaned token would hand group membership to a stranger.
  IF NOT EXISTS (
    SELECT 1 FROM current_expense_participants
    WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM current_expense_participants
    WHERE expense_id = v_rec.expense_id AND user_id = v_actor AND kind = 'user'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_participant';
  END IF;

  PERFORM assert_dm_pair_allowed(v_rec.group_id, v_actor);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = v_rec.group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  UPDATE guests
  SET claimed_by = v_actor,
      claimed_at = now(),
      claimed_version_no = v_rec.current_version_no
  WHERE id = v_rec.id;

  INSERT INTO group_members (group_id, user_id, status, accepted_at)
  VALUES (v_rec.group_id, v_actor, 'accepted', now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = 'accepted', accepted_at = COALESCE(group_members.accepted_at, now());

  -- Shared-history latch: the claim just granted membership for an existing
  -- expense to a new user, so the expense's facts are shared from now on.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_rec.group_id AND financial_history_shared_at IS NULL;

  v_ledger_version := recompute_group_balances(v_rec.group_id);

  v_event_id := emit_event(
    p_group_id => v_rec.group_id,
    p_kind => 'guest_claimed',
    p_actor => v_actor,
    p_expense_id => v_rec.expense_id,
    p_settlement_id => NULL,
    p_subject_user_id => v_actor,
    p_payload => jsonb_build_object('displayName', v_rec.display_name)
  );

  PERFORM broadcast_group(v_rec.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_rec.expense_id,
    'groupId', v_rec.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_guest(text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_guest(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
  v_out jsonb;
BEGIN
  v_user_id := current_user_id();
  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;
  PERFORM assert_member(v_group_id, v_user_id);
  SELECT jsonb_build_object(
    'expense', jsonb_build_object(
      'id', e.id,
      'groupId', e.group_id,
      'creatorId', e.creator_id,
      'status', e.status,
      'currentVersionNo', e.current_version_no,
      'occurredOn', to_jsonb(e.occurred_on),
      'createdAt', to_jsonb(e.created_at),
      'deletedAt', to_jsonb(e.deleted_at),
      'deletedBy', e.deleted_by
    ),
    'current', ledger_expense_version_json(e.id, e.current_version_no),
    'versions', COALESCE((
      SELECT jsonb_agg(ledger_expense_version_json(v.expense_id, v.version_no) ORDER BY v.version_no DESC)
      FROM expense_versions v
      WHERE v.expense_id = e.id
    ), '[]'::jsonb),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'participantIndex', ep.participant_index,
        'kind', ep.kind,
        'shareCents', ep.share_cents,
        'paidCents', ep.paid_cents,
        'user', COALESCE(ledger_user_profile_json(ep.user_id), 'null'::jsonb),
        'guest', COALESCE((
          SELECT jsonb_build_object('id', gst.id, 'displayName', gst.display_name, 'claimedBy', gst.claimed_by, 'claimLinkGeneration', COALESCE((SELECT ct.generation FROM guest_credentials.claim_tokens ct WHERE ct.guest_id = gst.id), 0))
          FROM guests gst
          WHERE gst.id = ep.guest_id
        ), 'null'::jsonb)
      ) ORDER BY ep.participant_index ASC)
      FROM current_expense_participants ep
      WHERE ep.expense_id = e.id
    ), '[]'::jsonb),
    'group', (
      SELECT jsonb_build_object('id', gg.id, 'name', gg.name, 'kind', gg.kind)
      FROM groups gg
      WHERE gg.id = e.group_id
    )
  ) INTO v_out
  FROM expenses e
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_expense(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.group_pairwise_edges(p_group_id uuid)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH nets AS (
    SELECT e.id AS expense_id,
           cep.kind,
           COALESCE(cep.user_id, cep.guest_id) AS participant_id,
           (cep.paid_cents - cep.share_cents)::bigint AS net
      FROM public.expenses e
      JOIN public.current_expense_participants cep ON cep.expense_id = e.id
     WHERE e.group_id = p_group_id AND e.status = 'active'
  ),
  expense_edges AS (
    SELECT one.expense_id, f.from_kind, f.from_id, f.to_id, f.amount_cents
      FROM (SELECT DISTINCT n.expense_id FROM nets n) one
      CROSS JOIN LATERAL public.pairwise_from_nets(
             COALESCE((SELECT array_agg(n.kind ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}'::participant_kind[]),
             COALESCE((SELECT array_agg(n.participant_id ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}'),
             COALESCE((SELECT array_agg(n.net ORDER BY n.kind, n.participant_id)
                         FROM nets n WHERE n.expense_id = one.expense_id), '{}')
           ) f
  ),
  edge_with_kinds AS (
    SELECT ee.from_id, ee.to_id, ee.from_kind, kt.kind AS to_kind, ee.amount_cents
      FROM expense_edges ee
      JOIN nets kt ON kt.expense_id = ee.expense_id AND kt.participant_id = ee.to_id
  ),
  normalized AS (
    SELECT CASE WHEN k.from_id < k.to_id THEN k.from_id ELSE k.to_id END AS left_id,
           CASE WHEN k.from_id < k.to_id THEN k.to_id ELSE k.from_id END AS right_id,
           CASE WHEN k.from_id < k.to_id THEN k.from_kind ELSE k.to_kind END AS left_kind,
           CASE WHEN k.from_id < k.to_id THEN k.to_kind ELSE k.from_kind END AS right_kind,
           CASE WHEN k.from_id < k.to_id THEN k.amount_cents ELSE -k.amount_cents END AS amount
      FROM edge_with_kinds k
  ),
  settlement_deltas AS (
    SELECT CASE WHEN s.from_user_id < s.to_user_id THEN s.from_user_id ELSE s.to_user_id END AS left_id,
           CASE WHEN s.from_user_id < s.to_user_id THEN s.to_user_id ELSE s.from_user_id END AS right_id,
           'user'::participant_kind AS left_kind,
           'user'::participant_kind AS right_kind,
           CASE WHEN s.from_user_id < s.to_user_id THEN -s.amount_cents ELSE s.amount_cents END AS amount
      FROM public.settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ),
  combined AS (
    SELECT d.left_id,
           d.right_id,
           MAX(d.left_kind) AS left_kind,
           MAX(d.right_kind) AS right_kind,
           SUM(d.amount) AS net
      FROM (
        SELECT left_id, right_id, left_kind, right_kind, amount FROM normalized
        UNION ALL
        SELECT left_id, right_id, left_kind, right_kind, amount FROM settlement_deltas
      ) d
     GROUP BY d.left_id, d.right_id
  )
  SELECT (CASE WHEN c.net > 0 THEN c.left_kind ELSE c.right_kind END)::participant_kind,
         (CASE WHEN c.net > 0 THEN c.left_id ELSE c.right_id END)::uuid,
         (CASE WHEN c.net > 0 THEN c.right_id ELSE c.left_id END)::uuid,
         (CASE WHEN c.net > 0 THEN c.net ELSE -c.net END)::bigint
    FROM combined c
   WHERE c.net <> 0
   ORDER BY 1, 2, 3;
END;
$$;
REVOKE ALL ON FUNCTION public.group_pairwise_edges(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.group_pairwise_edges(uuid) TO service_role;

ALTER TABLE public.expenses ADD CONSTRAINT expenses_current_version_positive CHECK (current_version_no >= 1);
ALTER TABLE public.group_balances ADD CONSTRAINT group_balances_nonzero CHECK (net_cents <> 0);

DROP FUNCTION IF EXISTS public.materialize_participants(uuid, uuid, jsonb);
DROP TABLE public.expense_participants;
