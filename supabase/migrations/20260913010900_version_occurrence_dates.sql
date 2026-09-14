-- P12: Version-owned occurrence dates and deferred version foreign keys
--
-- Defect: Editing only the date previously rewrote every historical version's
-- returned date because occurred_on lived on the expenses header, shadowing
-- version history.
--
-- 1. Add occurred_on to expense_versions, backfill from expenses.occurred_on,
--    then enforce NOT NULL.
-- 2. Add deferred composite foreign keys:
--    - expenses (id, current_version_no) -> expense_versions (expense_id, version_no) DEFERRABLE INITIALLY DEFERRED
--    - guests (expense_id, claimed_version_no) -> expense_versions (expense_id, version_no) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
-- 3. Replace create_expense, edit_expense, create_expense_with_group,
--    ledger_expense_version_json, ledger_expense_summary_json, get_expense.
-- 4. Drop expenses.occurred_on and the date-based expenses_group_idx.

ALTER TABLE public.expense_versions ADD COLUMN occurred_on date;

UPDATE public.expense_versions ev
SET occurred_on = e.occurred_on
FROM public.expenses e
WHERE e.id = ev.expense_id;

ALTER TABLE public.expense_versions ALTER COLUMN occurred_on SET NOT NULL;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_current_version_fk
  FOREIGN KEY (id, current_version_no)
  REFERENCES public.expense_versions(expense_id, version_no)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.guests
  ADD CONSTRAINT guests_claimed_version_fk
  FOREIGN KEY (expense_id, claimed_version_no)
  REFERENCES public.expense_versions(expense_id, version_no)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.ledger_expense_version_json(p_expense_id uuid, p_version_no integer) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'expenseId', v.expense_id,
    'versionNo', v.version_no,
    'authorId', v.author_id,
    'createdAt', to_jsonb(v.created_at),
    'occurredOn', to_jsonb(v.occurred_on),
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'serviceFeeBasisPoints', v.service_fee_bps,
    'fixedFeeCents', v.fixed_fee_cents,
    'payload', effective_expense_payload(v.expense_id, v.version_no),
    'changeSummary', v.change_summary
  ) INTO v_out
  FROM expense_versions v
  WHERE v.expense_id = p_expense_id AND v.version_no = p_version_no;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_expense_version_json(uuid, integer) FROM public;

CREATE OR REPLACE FUNCTION public.ledger_expense_summary_json(p_expense_id uuid, p_viewer uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', e.id,
    'groupId', e.group_id,
    'creatorId', e.creator_id,
    'status', e.status,
    'occurredOn', to_jsonb(v.occurred_on),
    'createdAt', to_jsonb(e.created_at),
    'versionNo', e.current_version_no,
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'myShareCents', COALESCE(part.my_share_cents, 0),
    'myPaidCents', COALESCE(part.my_paid_cents, 0),
    'participantCount', CASE WHEN e.status = 'deleted'
      THEN jsonb_array_length(COALESCE(effective_expense_payload(e.id, e.current_version_no) -> 'participants', '[]'::jsonb))
      ELSE COALESCE(part.participant_count, 0)
    END
  ) INTO v_out
  FROM expenses e
  JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
  LEFT JOIN LATERAL (
    SELECT
      sum(cep.share_cents) FILTER (WHERE cep.user_id = p_viewer)::integer AS my_share_cents,
      sum(cep.paid_cents) FILTER (WHERE cep.user_id = p_viewer)::integer AS my_paid_cents,
      count(*)::integer AS participant_count
    FROM current_expense_participants cep
    WHERE cep.expense_id = e.id
  ) part ON true
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_expense_summary_json(uuid, uuid) FROM public;

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
      'occurredOn', to_jsonb(v.occurred_on),
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
  JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_expense(uuid) TO authenticated;

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

REVOKE ALL ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_expense_with_group(
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

  -- Serialize retries on the client-supplied identity before looking for an
  -- existing expense. Without this lock, two concurrent retries both miss
  -- the pre-check, both create their own group, and the loser then replays
  -- the winner's expense against its own doomed group, which rolls back
  -- with invalid_argument instead of the replay ack the caller deserves.

  PERFORM pg_advisory_xact_lock(
    hashtextextended('create_expense_with_group:' || p_client_id::text, 0)
  );

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

DROP INDEX IF EXISTS public.expenses_group_idx;
ALTER TABLE public.expenses DROP COLUMN occurred_on;
