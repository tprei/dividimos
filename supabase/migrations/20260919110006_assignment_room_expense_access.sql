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

  IF EXISTS (
    SELECT 1 FROM public.assignment_rooms r
    WHERE r.expense_id = p_expense_id
      AND r.status = 'finalized'
      AND r.host_user_id <> v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.assignment_rooms r
    WHERE r.expense_id = p_expense_id AND r.status = 'finalized'
  ) AND (
    p_expense_type IS DISTINCT FROM 'itemized'::public.expense_type
    OR p_payload->'itemAssignments' IS NULL
    OR jsonb_typeof(p_payload->'itemAssignments') <> 'array'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
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
    expense_id, version_no, author_id, occurred_on, title, merchant_name, expense_type,
    total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
  ) VALUES (
    p_expense_id, v_new_version_no, v_actor, p_occurred_on, v_title, btrim(p_merchant_name), p_expense_type,
    p_total_cents, p_service_fee_bps, p_fixed_fee_cents, v_payload, NULL
  );

  v_change_summary := expense_change_summary(p_expense_id, v_current_version_no, v_new_version_no);
  UPDATE expense_versions SET change_summary = v_change_summary
  WHERE expense_id = p_expense_id AND version_no = v_new_version_no;

  UPDATE expenses SET current_version_no = v_new_version_no
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

  IF EXISTS (
    SELECT 1 FROM public.assignment_rooms r
    WHERE r.expense_id = p_expense_id
      AND r.status = 'finalized'
      AND r.host_user_id <> v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
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

  IF EXISTS (
    SELECT 1 FROM public.assignment_rooms r
    WHERE r.expense_id = p_expense_id
      AND r.status = 'finalized'
      AND r.host_user_id <> v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
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

CREATE FUNCTION public.assignment_room_bill_breakdown(
  p_expense_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_expense public.expenses%ROWTYPE;
  v_version public.expense_versions%ROWTYPE;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_version
  FROM public.expense_versions
  WHERE expense_id = p_expense_id
    AND version_no = v_expense.current_version_no;

  IF v_expense.status = 'deleted' THEN
    RETURN jsonb_build_object(
      'status', 'deleted',
      'versionNo', v_expense.current_version_no,
      'title', v_version.title,
      'occurredOn', to_jsonb(v_version.occurred_on),
      'items', '[]'::jsonb,
      'itemAssignments', NULL,
      'participants', '[]'::jsonb,
      'shares', '[]'::jsonb,
      'payers', '[]'::jsonb,
      'totalCents', 0,
      'serviceFeeBasisPoints', 0,
      'fixedFeeCents', 0
    );
  END IF;

  v_payload := public.effective_expense_payload(
    p_expense_id, v_expense.current_version_no
  );
  RETURN jsonb_build_object(
    'status', v_expense.status,
    'versionNo', v_expense.current_version_no,
    'title', v_version.title,
    'occurredOn', to_jsonb(v_version.occurred_on),
    'items', COALESCE(v_payload->'items', '[]'::jsonb),
    'itemAssignments', v_payload->'itemAssignments',
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'participantIndex', ord - 1,
        'displayName', CASE WHEN ref->>'kind' = 'user'
          THEN COALESCE(public.ledger_user_profile_json((ref->>'userId')::uuid)->>'name', 'Alguém')
          ELSE ref->>'displayName' END,
        'avatarUrl', CASE WHEN ref->>'kind' = 'user'
          THEN public.ledger_user_profile_json((ref->>'userId')::uuid)->'avatarUrl'
          ELSE 'null'::jsonb END,
        'isGuest', ref->>'kind' = 'guest'
      ) ORDER BY ord)
      FROM jsonb_array_elements(v_payload->'participants')
        WITH ORDINALITY AS refs(ref, ord)
    ), '[]'::jsonb),
    'shares', COALESCE(v_payload->'shares', '[]'::jsonb),
    'payers', COALESCE(v_payload->'payers', '[]'::jsonb),
    'totalCents', v_version.total_cents,
    'serviceFeeBasisPoints', v_version.service_fee_bps,
    'fixedFeeCents', v_version.fixed_fee_cents
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assignment_room_view(
  p_room_id uuid,
  p_self_participant_id uuid,
  p_host boolean
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_room public.assignment_rooms%ROWTYPE;
  v_snapshot jsonb;
  v_view jsonb;
  v_subtotal bigint;
  v_total bigint;
BEGIN
  SELECT * INTO v_room FROM public.assignment_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;

  SELECT COALESCE(sum(total_price_cents), 0) INTO v_subtotal
  FROM public.assignment_room_items WHERE room_id = p_room_id;
  v_total := v_subtotal
    + floor((v_subtotal::numeric * (v_room.header->>'serviceFeeBasisPoints')::integer + 5000) / 10000)
    + (v_room.header->>'fixedFeeCents')::integer;

  v_snapshot := jsonb_build_object(
    'id', v_room.id,
    'revision', v_room.revision,
    'status', v_room.status,
    'title', v_room.header->>'title',
    'occurredOn', v_room.header->>'occurredOn',
    'serviceFeeBasisPoints', (v_room.header->>'serviceFeeBasisPoints')::integer,
    'fixedFeeCents', (v_room.header->>'fixedFeeCents')::integer,
    'totalCents', v_total,
    'selfParticipantId', p_self_participant_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id,
        'ordinal', i.ordinal,
        'revision', i.revision,
        'description', i.description,
        'quantityMilliunits', i.quantity_milliunits,
        'unitPriceCents', i.unit_price_cents,
        'totalPriceCents', i.total_price_cents
      ) ORDER BY i.ordinal)
      FROM public.assignment_room_items i WHERE i.room_id = p_room_id
    ), '[]'::jsonb),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'ordinal', p.ordinal,
        'displayName', p.display_name,
        'avatarUrl', u.avatar_url,
        'isGuest', p.user_id IS NULL,
        'removed', p.removed_at IS NOT NULL
      ) ORDER BY p.ordinal)
      FROM public.assignment_room_participants p
      LEFT JOIN public.users u ON u.id = p.user_id
      WHERE p.room_id = p_room_id
    ), '[]'::jsonb),
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'itemId', c.item_id,
        'participantId', c.participant_id,
        'ticks', c.ticks
      ) ORDER BY i.ordinal, p.ordinal)
      FROM public.assignment_room_claims c
      JOIN public.assignment_room_items i ON i.room_id = c.room_id AND i.id = c.item_id
      JOIN public.assignment_room_participants p ON p.room_id = c.room_id AND p.id = c.participant_id
      WHERE c.room_id = p_room_id
    ), '[]'::jsonb),
    'topic', (SELECT a.broadcast_topic FROM guest_credentials.assignment_room_access a WHERE a.room_id = p_room_id),
    'currentBill', CASE WHEN v_room.expense_id IS NULL THEN NULL
      ELSE public.assignment_room_bill_breakdown(v_room.expense_id) END
  );

  IF NOT p_host THEN
    RETURN jsonb_build_object('role', 'participant', 'room', v_snapshot);
  END IF;

  v_view := jsonb_build_object(
    'role', 'host',
    'room', v_snapshot,
    'groupTarget', v_room.group_target,
    'participantRefs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'participantId', p.id,
        'ref', CASE WHEN p.user_id IS NOT NULL
          THEN jsonb_build_object('kind', 'user', 'userId', p.user_id)
          ELSE jsonb_build_object('kind', 'guest', 'guestId', NULL, 'displayName', p.display_name)
        END
      ) ORDER BY p.ordinal)
      FROM public.assignment_room_participants p
      WHERE p.room_id = p_room_id
    ), '[]'::jsonb)
  );
  RETURN v_view;
END;
$$;

CREATE FUNCTION public.get_expense_context(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_assignment_room jsonb;
BEGIN
  v_actor := public.current_user_id();
  SELECT group_id INTO v_group_id
  FROM public.expenses
  WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;
  PERFORM public.assert_member(v_group_id, v_actor);
  SELECT jsonb_build_object('id', r.id, 'hostUserId', r.host_user_id)
  INTO v_assignment_room
  FROM public.assignment_rooms r
  WHERE r.expense_id = p_expense_id AND r.status = 'finalized';
  RETURN jsonb_build_object(
    'detail', public.get_expense(p_expense_id),
    'assignmentRoom', v_assignment_room
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assignment_room_bill_breakdown(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_expense_context(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_expense_context(uuid) TO authenticated;

