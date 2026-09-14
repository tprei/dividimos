-- P9: Immutable guest claim facts + expense authorization matrix
--
-- Adds guests.claimed_version_no and the guests_claim_tuple_valid check constraint.
-- Guests claimed prior to P9 are backfilled from the expense's current_version_no.
-- Replaces payload mutation during claim_guest with immutable claim metadata
-- and the internal helper public.effective_expense_payload(uuid, integer).

ALTER TABLE public.guests ADD COLUMN claimed_version_no integer;

-- Backfill claimed_version_no for already-claimed guests from the expense's current version.
-- Historical payloads for already-claimed guests prior to P9 remain user-shaped
-- (intermediate disposable-playground limitation before epoch reset).
UPDATE public.guests g
SET claimed_version_no = e.current_version_no
FROM public.expenses e
WHERE g.expense_id = e.id
  AND g.claimed_by IS NOT NULL
  AND g.claimed_version_no IS NULL;

ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_check;
ALTER TABLE public.guests ADD CONSTRAINT guests_claim_tuple_valid CHECK (
  (claimed_by IS NULL AND claimed_at IS NULL AND claimed_version_no IS NULL) OR
  (claimed_by IS NOT NULL AND claimed_at IS NOT NULL AND claimed_version_no IS NOT NULL)
);

CREATE OR REPLACE FUNCTION public.effective_expense_payload(p_expense_id uuid, p_version_no integer)
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_participants jsonb;
  v_new_participants jsonb;
BEGIN
  SELECT payload INTO v_payload
  FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = p_version_no;

  IF v_payload IS NULL THEN
    RETURN NULL;
  END IF;

  v_participants := v_payload->'participants';
  IF v_participants IS NULL OR jsonb_typeof(v_participants) <> 'array' THEN
    RETURN v_payload;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_participants) AS p
    JOIN guests g
      ON g.id = (p->>'guestId')::uuid
     AND g.expense_id = p_expense_id
     AND g.claimed_version_no = p_version_no
     AND g.claimed_by IS NOT NULL
    WHERE p->>'kind' = 'guest'
      AND p ? 'guestId'
      AND (p->>'guestId') ~ '^[0-9a-fA-F-]{36}$'
  ) THEN
    RETURN v_payload;
  END IF;

  SELECT jsonb_agg(
    CASE
      WHEN p->>'kind' = 'guest'
       AND p ? 'guestId'
       AND (p->>'guestId') ~ '^[0-9a-fA-F-]{36}$'
       AND g.claimed_by IS NOT NULL
      THEN jsonb_build_object('kind', 'user', 'userId', g.claimed_by)
      ELSE p
    END
    ORDER BY ord
  )
  INTO v_new_participants
  FROM jsonb_array_elements(v_participants) WITH ORDINALITY AS t(p, ord)
  LEFT JOIN guests g
    ON (p->>'kind' = 'guest' AND p ? 'guestId' AND (p->>'guestId') ~ '^[0-9a-fA-F-]{36}$')
   AND g.id = (p->>'guestId')::uuid
   AND g.expense_id = p_expense_id
   AND g.claimed_version_no = p_version_no;

  RETURN jsonb_set(v_payload, '{participants}', COALESCE(v_new_participants, '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.effective_expense_payload(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_expense_payload(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_participants(p_expense_id uuid, p_author uuid, p_payload jsonb)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_participants jsonb;
  v_n integer;
  v_i integer;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_id uuid;
  v_new_guest_id uuid;
  v_display_name text;
  v_claimed_by uuid;
  v_share integer;
  v_paid integer;
  v_payers jsonb;
  v_j integer;
  v_payer jsonb;
  v_out_participants jsonb := '[]'::jsonb;
  v_out jsonb;
  v_seen_users uuid[] := '{}';
  v_current_version integer;
  v_prev_payload jsonb;
  v_existing_user_ids uuid[] := '{}';
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
  v_n := jsonb_array_length(v_participants);
  v_payers := COALESCE(p_payload->'payers', '[]'::jsonb);

  DELETE FROM expense_participants WHERE expense_id = p_expense_id;

  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_user_id := NULL;
    v_guest_id := NULL;
    v_new_guest_id := NULL;
    v_claimed_by := NULL;
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
        SELECT id, claimed_by INTO v_new_guest_id, v_claimed_by
        FROM guests WHERE id = v_guest_id AND expense_id = p_expense_id;
        IF v_new_guest_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
        END IF;
      ELSE
        INSERT INTO guests (expense_id, display_name) VALUES (p_expense_id, v_display_name)
        RETURNING id INTO v_new_guest_id;
      END IF;
      IF v_claimed_by IS NOT NULL THEN
        v_guest_id := NULL;
        v_user_id := v_claimed_by;
        PERFORM assert_dm_pair_allowed(v_group_id, v_user_id);
        IF NOT is_member_or_invited(v_group_id, v_user_id)
           AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
        END IF;
      ELSE
        v_guest_id := v_new_guest_id;
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;

    IF v_user_id IS NOT NULL THEN
      IF v_user_id = ANY (v_seen_users) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
      END IF;
      v_seen_users := array_append(v_seen_users, v_user_id);
    END IF;

    v_share := (p_payload->'shares'->v_i)::integer;
    v_paid := 0;
    v_j := 0;
    WHILE v_j < jsonb_array_length(v_payers) LOOP
      v_payer := v_payers->v_j;
      IF (v_payer->>'participantIndex')::integer = v_i THEN
        v_paid := v_paid + (v_payer->>'amountCents')::integer;
      END IF;
      v_j := v_j + 1;
    END LOOP;

    INSERT INTO expense_participants (expense_id, participant_index, kind, user_id, guest_id, share_cents, paid_cents)
    VALUES (
      p_expense_id, v_i,
      CASE WHEN v_user_id IS NOT NULL THEN 'user'::participant_kind ELSE 'guest'::participant_kind END,
      v_user_id, v_guest_id, v_share, v_paid
    );

    IF v_user_id IS NOT NULL THEN
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'user', 'userId', v_user_id);
    ELSE
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'guest', 'guestId', v_guest_id, 'displayName', v_display_name);
    END IF;
    v_i := v_i + 1;
  END LOOP;

  -- An unclaimed guest with no participant slot left is unreachable; its
  -- claim token would otherwise still redeem into group membership.
  DELETE FROM guests g
  WHERE g.expense_id = p_expense_id
    AND g.claimed_by IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM expense_participants ep
      WHERE ep.expense_id = p_expense_id AND ep.guest_id = g.id
    );

  v_out := jsonb_set(p_payload, '{participants}', v_out_participants);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.materialize_participants(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_participants(uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.expense_change_summary(p_expense_id uuid, p_from integer, p_to integer) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r_old expense_versions;
  r_new expense_versions;
  v_old_payload jsonb;
  v_new_payload jsonb;
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_i integer;
  v_id uuid;
  v_old_payers jsonb;
  v_new_payers jsonb;
  v_old_norm jsonb := '[]'::jsonb;
  v_new_norm jsonb := '[]'::jsonb;
  v_old_total bigint := 0;
  v_new_total bigint := 0;
  v_participants jsonb;
  v_n integer;
  v_j integer;
  v_payer jsonb;
  v_idx integer;
  v_participant jsonb;
  v_pid uuid;
BEGIN
  SELECT * INTO r_old FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = p_from;
  SELECT * INTO r_new FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = p_to;
  IF r_old.expense_id IS NULL OR r_new.expense_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  v_old_payload := effective_expense_payload(p_expense_id, p_from);
  v_new_payload := effective_expense_payload(p_expense_id, p_to);

  v_participants := v_old_payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_pid := CASE WHEN v_participant->>'kind' = 'user'
              THEN (v_participant->>'userId')::uuid
              ELSE (v_participant->>'guestId')::uuid END;
    v_old_ids := array_append(v_old_ids, v_pid);
    v_i := v_i + 1;
  END LOOP;
  v_participants := v_new_payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_pid := CASE WHEN v_participant->>'kind' = 'user'
              THEN (v_participant->>'userId')::uuid
              ELSE (v_participant->>'guestId')::uuid END;
    v_new_ids := array_append(v_new_ids, v_pid);
    v_i := v_i + 1;
  END LOOP;

  v_i := 0;
  WHILE v_i < COALESCE(array_length(v_new_ids, 1), 0) LOOP
    v_id := v_new_ids[v_i + 1];
    IF NOT (v_id = ANY (v_old_ids)) THEN
      v_added := array_append(v_added, v_id);
    END IF;
    v_i := v_i + 1;
  END LOOP;
  v_i := 0;
  WHILE v_i < COALESCE(array_length(v_old_ids, 1), 0) LOOP
    v_id := v_old_ids[v_i + 1];
    IF NOT (v_id = ANY (v_new_ids)) THEN
      v_removed := array_append(v_removed, v_id);
    END IF;
    v_i := v_i + 1;
  END LOOP;

  v_old_payers := v_old_payload->'payers';
  v_new_payers := v_new_payload->'payers';
  v_participants := v_old_payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_j := 0;
  WHILE v_j < jsonb_array_length(v_old_payers) LOOP
    v_payer := v_old_payers->v_j;
    v_idx := (v_payer->>'participantIndex')::integer;
    v_pid := CASE WHEN v_participants->v_idx->>'kind' = 'user'
              THEN (v_participants->v_idx->>'userId')::uuid
              ELSE (v_participants->v_idx->>'guestId')::uuid END;
    v_old_norm := v_old_norm || jsonb_build_object('participantId', v_pid, 'amountCents', (v_payer->>'amountCents')::integer);
    v_old_total := v_old_total + (v_payer->>'amountCents')::bigint;
    v_j := v_j + 1;
  END LOOP;
  v_participants := v_new_payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_j := 0;
  WHILE v_j < jsonb_array_length(v_new_payers) LOOP
    v_payer := v_new_payers->v_j;
    v_idx := (v_payer->>'participantIndex')::integer;
    v_pid := CASE WHEN v_participants->v_idx->>'kind' = 'user'
              THEN (v_participants->v_idx->>'userId')::uuid
              ELSE (v_participants->v_idx->>'guestId')::uuid END;
    v_new_norm := v_new_norm || jsonb_build_object('participantId', v_pid, 'amountCents', (v_payer->>'amountCents')::integer);
    v_new_total := v_new_total + (v_payer->>'amountCents')::bigint;
    v_j := v_j + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'title', CASE WHEN r_old.title = r_new.title THEN NULL
             ELSE jsonb_build_array(r_old.title, r_new.title) END,
    'totalCents', CASE WHEN r_old.total_cents = r_new.total_cents THEN NULL
                  ELSE jsonb_build_array(r_old.total_cents, r_new.total_cents) END,
    'participantsAdded', COALESCE(to_jsonb(v_added), '[]'::jsonb),
    'participantsRemoved', COALESCE(to_jsonb(v_removed), '[]'::jsonb),
    'payersChanged', NOT (
      v_old_total = v_new_total
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_old_norm) o(e)
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_norm) n(e) WHERE n.e = o.e)
      )
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_new_norm) n2(e)
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_old_norm) o2(e) WHERE o2.e = n2.e)
      )
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.expense_change_summary(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expense_change_summary(uuid, integer, integer) TO service_role;

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
    'occurredOn', to_jsonb(e.occurred_on),
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
  JOIN expenses e ON e.id = v.expense_id
  WHERE v.expense_id = p_expense_id AND v.version_no = p_version_no;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_expense_version_json(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_expense_version_json(uuid, integer) TO service_role;

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
    'occurredOn', to_jsonb(e.occurred_on),
    'createdAt', to_jsonb(e.created_at),
    'versionNo', e.current_version_no,
    'title', v.title,
    'merchantName', v.merchant_name,
    'expenseType', v.expense_type,
    'totalCents', v.total_cents,
    'myShareCents', COALESCE((
      SELECT ep.share_cents FROM expense_participants ep
      WHERE ep.expense_id = e.id AND ep.user_id = p_viewer
    ), 0),
    'myPaidCents', COALESCE((
      SELECT ep.paid_cents FROM expense_participants ep
      WHERE ep.expense_id = e.id AND ep.user_id = p_viewer
    ), 0),
    'participantCount', CASE WHEN e.status = 'deleted'
      THEN jsonb_array_length(COALESCE(effective_expense_payload(e.id, e.current_version_no) -> 'participants', '[]'::jsonb))
      ELSE (SELECT count(*)::integer FROM expense_participants ep WHERE ep.expense_id = e.id)
    END
  ) INTO v_out
  FROM expenses e
  JOIN expense_versions v ON v.expense_id = e.id AND v.version_no = e.current_version_no
  WHERE e.id = p_expense_id;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.ledger_expense_summary_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_expense_summary_json(uuid, uuid) TO service_role;

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

  v_materialized := materialize_participants(p_expense_id, v_actor, v_payload);

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
REVOKE ALL ON FUNCTION public.restore_expense(uuid) FROM PUBLIC, anon;
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

        DELETE FROM expense_participants WHERE expense_id = v_rec.expense_id;

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
REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO authenticated;

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
    SELECT 1 FROM expense_participants
    WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM expense_participants
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

  UPDATE expense_participants
  SET kind = 'user',
      user_id = v_actor,
      guest_id = NULL
  WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id;

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
REVOKE ALL ON FUNCTION public.claim_guest(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_guest(text) TO authenticated;
