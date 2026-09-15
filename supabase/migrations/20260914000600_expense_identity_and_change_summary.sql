CREATE FUNCTION public.effective_expense_payload(p_expense_id uuid, p_version_no integer)
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

CREATE FUNCTION public.resolve_expense_participants(p_expense_id uuid, p_payload jsonb)
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

CREATE FUNCTION public.expense_change_summary(p_expense_id uuid, p_from integer, p_to integer) RETURNS jsonb
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
