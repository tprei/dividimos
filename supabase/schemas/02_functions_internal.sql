CREATE FUNCTION public.current_user_id() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT auth.uid() INTO v_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  RETURN v_user_id;
END;
$$;

CREATE FUNCTION public.assert_member(p_group_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;
END;
$$;

CREATE FUNCTION public.assert_member_or_invited(p_group_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status IN ('invited', 'accepted')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;
END;
$$;

CREATE FUNCTION public.is_member(p_group_id uuid, p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND status = 'accepted'
  )
$$;

CREATE FUNCTION public.lock_group(p_group_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_not_found';
  END IF;
END;
$$;

CREATE FUNCTION public.recompute_group_balances(p_group_id uuid) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_version bigint;
BEGIN
  DELETE FROM group_balances WHERE group_id = p_group_id;
  INSERT INTO group_balances (group_id, kind, participant_id, net_cents)
  SELECT p_group_id, kind, participant_id, SUM(delta)
  FROM (
    SELECT ep.kind, COALESCE(ep.user_id, ep.guest_id) AS participant_id,
           (ep.paid_cents - ep.share_cents)::bigint AS delta
    FROM expense_participants ep
    JOIN expenses e ON e.id = ep.expense_id
    WHERE e.group_id = p_group_id AND e.status = 'active'
    UNION ALL
    SELECT 'user'::participant_kind, s.from_user_id, s.amount_cents::bigint FROM settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
    UNION ALL
    SELECT 'user'::participant_kind, s.to_user_id, -s.amount_cents::bigint FROM settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ) t
  GROUP BY kind, participant_id
  HAVING SUM(delta) <> 0;
  UPDATE groups SET ledger_version = ledger_version + 1 WHERE id = p_group_id
    RETURNING ledger_version INTO v_version;
  RETURN v_version;
END;
$$;

CREATE FUNCTION public.emit_event(
  p_group_id uuid, p_kind event_kind, p_actor uuid,
  p_expense_id uuid DEFAULT NULL, p_settlement_id uuid DEFAULT NULL,
  p_subject_user_id uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event_id bigint;
BEGIN
  INSERT INTO group_events (group_id, actor_id, kind, expense_id, settlement_id, subject_user_id, payload)
  VALUES (p_group_id, p_actor, p_kind, p_expense_id, p_settlement_id, p_subject_user_id, p_payload)
  RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;

CREATE FUNCTION public.broadcast_group(p_group_id uuid, p_ledger_version bigint, p_event_id bigint) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('group_id', p_group_id, 'ledger_version', p_ledger_version, 'event_id', p_event_id),
    'ledger', 'group:' || p_group_id::text, true
  );
END;
$$;

CREATE FUNCTION public.validate_expense_payload(p jsonb, p_expense_type expense_type, p_total integer, p_fee_bps integer, p_fixed_fee integer)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_items jsonb;
  v_participants jsonb;
  v_shares jsonb;
  v_payers jsonb;
  v_item_assignments jsonb;
  v_n integer;
  v_i integer;
  v_participant jsonb;
  v_item jsonb;
  v_payer jsonb;
  v_assignment jsonb;
  v_share integer;
  v_share_sum bigint := 0;
  v_payer_sum bigint := 0;
  v_item_sum bigint := 0;
  v_fee integer;
  v_payer_indexes integer[];
  v_seen_user_ids uuid[];
  v_seen_guest_ids uuid[];
  v_user_id uuid;
  v_guest_id uuid;
  v_item_index integer;
  v_participant_index integer;
  v_amount integer;
  v_item_total integer;
  v_assignment_sum bigint;
  v_j integer;
  v_guest_id_for_user uuid;
  v_display_name text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  IF p_total IS NULL OR p_total < 1 OR p_total > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  IF p_fee_bps IS NULL OR p_fee_bps < 0 OR p_fee_bps > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  IF p_fixed_fee IS NULL OR p_fixed_fee < 0 OR p_fixed_fee > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  IF p ? 'items' THEN v_items := p->'items'; ELSE v_items := NULL; END IF;
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_n := jsonb_array_length(v_items);
  IF v_n > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'too_many_items';
  END IF;
  IF p_expense_type = 'itemized' AND v_n = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_i := 0;
  WHILE v_i < v_n LOOP
    v_item := v_items->v_i;
    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k
                  WHERE k NOT IN ('description', 'quantityMilliunits', 'unitPriceCents', 'totalPriceCents'))
       OR NOT (v_item ? 'description' AND v_item ? 'quantityMilliunits' AND v_item ? 'unitPriceCents' AND v_item ? 'totalPriceCents')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_item->'quantityMilliunits') <> 'number'
       OR (v_item->>'quantityMilliunits')::numeric <> floor((v_item->>'quantityMilliunits')::numeric)
       OR (v_item->>'quantityMilliunits')::numeric < 1
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_item->'unitPriceCents') <> 'number'
       OR (v_item->>'unitPriceCents')::text <> floor((v_item->>'unitPriceCents')::numeric)::text
       OR (v_item->>'unitPriceCents')::numeric < 0
       OR (v_item->>'unitPriceCents')::numeric > 99999999
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_item->'totalPriceCents') <> 'number'
       OR (v_item->>'totalPriceCents')::text <> floor((v_item->>'totalPriceCents')::numeric)::text
       OR (v_item->>'totalPriceCents')::numeric < 0
       OR (v_item->>'totalPriceCents')::numeric > 99999999
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF v_item->'description' IS NOT NULL AND jsonb_typeof(v_item->'description') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_i := v_i + 1;
  END LOOP;

  IF p ? 'participants' THEN v_participants := p->'participants'; ELSE v_participants := NULL; END IF;
  IF v_participants IS NULL OR jsonb_typeof(v_participants) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_n := jsonb_array_length(v_participants);
  IF v_n > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'too_many_participants';
  END IF;
  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    IF v_participant IS NULL OR jsonb_typeof(v_participant) <> 'object' OR NOT (v_participant ? 'kind') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF v_participant->>'kind' = 'user' THEN
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_participant) k WHERE k NOT IN ('kind', 'userId'))
         OR jsonb_typeof(v_participant->'userId') <> 'string'
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_user_id := (v_participant->>'userId')::uuid;
      IF v_user_id = ANY (v_seen_user_ids) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
      END IF;
      v_seen_user_ids := array_append(v_seen_user_ids, v_user_id);
    ELSIF v_participant->>'kind' = 'guest' THEN
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_participant) k WHERE k NOT IN ('kind', 'guestId', 'displayName'))
         OR jsonb_typeof(v_participant->'displayName') <> 'string'
         OR length(v_participant->>'displayName') < 1
         OR length(v_participant->>'displayName') > 80
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF v_participant ? 'guestId' AND jsonb_typeof(v_participant->'guestId') NOT IN ('null', 'string') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF jsonb_typeof(v_participant->'guestId') = 'string' THEN
        v_guest_id := (v_participant->>'guestId')::uuid;
        IF v_guest_id = ANY (v_seen_guest_ids) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
        END IF;
        v_seen_guest_ids := array_append(v_seen_guest_ids, v_guest_id);
      ELSE
        v_guest_id := NULL;
      END IF;
      v_display_name := v_participant->>'displayName';
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_i := v_i + 1;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  IF p ? 'shares' THEN v_shares := p->'shares'; ELSE v_shares := NULL; END IF;
  IF v_shares IS NULL OR jsonb_typeof(v_shares) <> 'array'
     OR jsonb_array_length(v_shares) <> jsonb_array_length(v_participants)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_i := 0;
  WHILE v_i < jsonb_array_length(v_shares) LOOP
    IF jsonb_typeof(v_shares->v_i) <> 'number'
       OR (v_shares->>v_i)::text <> floor((v_shares->>v_i)::numeric)::text
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_share := (v_shares->>v_i)::integer;
    IF v_share < 0 OR v_share > 99999999 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_share_sum := v_share_sum + v_share;
    v_i := v_i + 1;
  END LOOP;
  IF v_share_sum <> p_total THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'share_total_mismatch';
  END IF;

  IF p ? 'payers' THEN v_payers := p->'payers'; ELSE v_payers := NULL; END IF;
  IF v_payers IS NULL OR jsonb_typeof(v_payers) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_i := 0;
  WHILE v_i < jsonb_array_length(v_payers) LOOP
    v_payer := v_payers->v_i;
    IF v_payer IS NULL OR jsonb_typeof(v_payer) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_payer) k WHERE k NOT IN ('participantIndex', 'amountCents'))
       OR NOT (v_payer ? 'participantIndex' AND v_payer ? 'amountCents')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_payer->'participantIndex') <> 'number'
       OR (v_payer->>'participantIndex')::text <> floor((v_payer->>'participantIndex')::numeric)::text
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_participant_index := (v_payer->>'participantIndex')::integer;
    IF v_participant_index < 0 OR v_participant_index >= jsonb_array_length(v_participants) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF v_participant_index = ANY (v_payer_indexes) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_payer_indexes := array_append(v_payer_indexes, v_participant_index);
    IF v_participants->v_participant_index->>'kind' <> 'user' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_cannot_pay';
    END IF;
    IF jsonb_typeof(v_payer->'amountCents') <> 'number'
       OR (v_payer->>'amountCents')::text <> floor((v_payer->>'amountCents')::numeric)::text
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_amount := (v_payer->>'amountCents')::integer;
    IF v_amount < 1 OR v_amount > 99999999 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_payer_sum := v_payer_sum + v_amount;
    v_i := v_i + 1;
  END LOOP;
  IF v_payer_sum <> p_total THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'payer_total_mismatch';
  END IF;

  IF p_expense_type = 'itemized' THEN
    v_i := 0;
    WHILE v_i < jsonb_array_length(v_items) LOOP
      v_item_sum := v_item_sum + (v_items->v_i->>'totalPriceCents')::integer;
      v_i := v_i + 1;
    END LOOP;
    v_fee := (v_item_sum * p_fee_bps + 5000) / 10000;
    IF v_item_sum + v_fee + p_fixed_fee <> p_total THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'itemized_total_mismatch';
    END IF;
  END IF;

  IF p ? 'itemAssignments' AND jsonb_typeof(p->'itemAssignments') <> 'null' THEN
    v_item_assignments := p->'itemAssignments';
    IF jsonb_typeof(v_item_assignments) <> 'array' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_i := 0;
    WHILE v_i < jsonb_array_length(v_item_assignments) LOOP
      v_assignment := v_item_assignments->v_i;
      IF v_assignment IS NULL OR jsonb_typeof(v_assignment) <> 'object'
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_assignment) k WHERE k NOT IN ('itemIndex', 'participantIndex', 'amountCents'))
         OR NOT (v_assignment ? 'itemIndex' AND v_assignment ? 'participantIndex' AND v_assignment ? 'amountCents')
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF jsonb_typeof(v_assignment->'itemIndex') <> 'number'
         OR (v_assignment->>'itemIndex')::text <> floor((v_assignment->>'itemIndex')::numeric)::text
         OR jsonb_typeof(v_assignment->'participantIndex') <> 'number'
         OR (v_assignment->>'participantIndex')::text <> floor((v_assignment->>'participantIndex')::numeric)::text
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_item_index := (v_assignment->>'itemIndex')::integer;
      v_participant_index := (v_assignment->>'participantIndex')::integer;
      IF v_item_index < 0 OR v_item_index >= jsonb_array_length(v_items)
         OR v_participant_index < 0 OR v_participant_index >= jsonb_array_length(v_participants)
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF jsonb_typeof(v_assignment->'amountCents') <> 'number'
         OR (v_assignment->>'amountCents')::text <> floor((v_assignment->>'amountCents')::numeric)::text
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_amount := (v_assignment->>'amountCents')::integer;
      IF v_amount < 0 OR v_amount > 99999999 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_i := v_i + 1;
    END LOOP;
    v_i := 0;
    WHILE v_i < jsonb_array_length(v_items) LOOP
      v_item_total := (v_items->v_i->>'totalPriceCents')::integer;
      v_assignment_sum := 0;
      v_j := 0;
      WHILE v_j < jsonb_array_length(v_item_assignments) LOOP
        v_assignment := v_item_assignments->v_j;
        IF (v_assignment->>'itemIndex')::integer = v_i THEN
          v_assignment_sum := v_assignment_sum + (v_assignment->>'amountCents')::integer;
        END IF;
        v_j := v_j + 1;
      END LOOP;
      IF v_assignment_sum <> v_item_total THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_i := v_i + 1;
    END LOOP;
  ELSE
    v_item_assignments := NULL;
  END IF;

  RETURN jsonb_build_object(
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'description', x->'description',
        'quantityMilliunits', (x->>'quantityMilliunits')::bigint,
        'unitPriceCents', (x->>'unitPriceCents')::integer,
        'totalPriceCents', (x->>'totalPriceCents')::integer
      ) ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(x, ord)
    ),
    'participants', (
      SELECT COALESCE(jsonb_agg(
        CASE WHEN x->>'kind' = 'user'
          THEN jsonb_build_object('kind', 'user', 'userId', x->>'userId')
          ELSE jsonb_build_object('kind', 'guest', 'guestId', x->'guestId', 'displayName', x->>'displayName')
        END ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_participants) WITH ORDINALITY AS t(x, ord)
    ),
    'shares', (
      SELECT COALESCE(jsonb_agg((s->>0)::integer ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_shares) WITH ORDINALITY AS t(s, ord)
    ),
    'payers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'participantIndex', (x->>'participantIndex')::integer,
        'amountCents', (x->>'amountCents')::integer
      ) ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_payers) WITH ORDINALITY AS t(x, ord)
    ),
    'itemAssignments', CASE WHEN v_item_assignments IS NULL THEN NULL ELSE (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'itemIndex', (x->>'itemIndex')::integer,
        'participantIndex', (x->>'participantIndex')::integer,
        'amountCents', (x->>'amountCents')::integer
      ) ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_item_assignments) WITH ORDINALITY AS t(x, ord)
    ) END
  );
END;
$$;

CREATE FUNCTION public.materialize_participants(p_expense_id uuid, p_author uuid, p_payload jsonb)
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
BEGIN
  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

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
      IF NOT is_member(v_group_id, v_user_id) THEN
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
        IF NOT is_member(v_group_id, v_user_id) THEN
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

  v_out := jsonb_set(p_payload, '{participants}', v_out_participants);
  RETURN v_out;
END;
$$;

CREATE FUNCTION public.expense_change_summary(p_expense_id uuid, p_from integer, p_to integer) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r_old expense_versions;
  r_new expense_versions;
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_i integer;
  v_id uuid;
  v_old_payers jsonb;
  v_new_payers jsonb;
  v_old_norm jsonb;
  v_new_norm jsonb;
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

  v_participants := r_old.payload->'participants';
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
  v_participants := r_new.payload->'participants';
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

  v_old_payers := r_old.payload->'payers';
  v_new_payers := r_new.payload->'payers';
  v_participants := r_old.payload->'participants';
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
  v_participants := r_new.payload->'participants';
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
      AND (
        (v_old_norm IS NULL AND v_new_norm IS NULL)
        OR (
          v_old_norm IS NOT NULL AND v_new_norm IS NOT NULL
          AND (
            SELECT count(*) = 0
            FROM jsonb_array_elements(v_old_norm) WITH ORDINALITY AS o(e, ord)
            WHERE NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(v_new_norm) n
              WHERE n = o.e
            )
          )
          AND (
            SELECT count(*) = 0
            FROM jsonb_array_elements(v_new_norm) WITH ORDINALITY AS n2(e, ord)
            WHERE NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(v_old_norm) o2
              WHERE o2 = n2.e
            )
          )
        )
      )
    )
  );
END;
$$;

CREATE FUNCTION public.group_transfers(p_group_id uuid)
RETURNS TABLE (from_kind participant_kind, from_id uuid, to_id uuid, amount_cents bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_debtor_kinds participant_kind[];
  v_debtor_ids uuid[];
  v_debtor_open bigint[];
  v_creditor_ids uuid[];
  v_creditor_open bigint[];
  v_di integer := 1;
  v_ci integer := 1;
  v_amount bigint;
BEGIN
  SELECT COALESCE(array_agg(kind ORDER BY net_cents ASC, participant_id ASC), '{}'),
         COALESCE(array_agg(participant_id ORDER BY net_cents ASC, participant_id ASC), '{}'),
         COALESCE(array_agg(-net_cents ORDER BY net_cents ASC, participant_id ASC), '{}')
    INTO v_debtor_kinds, v_debtor_ids, v_debtor_open
    FROM group_balances WHERE group_id = p_group_id AND net_cents < 0;
  SELECT COALESCE(array_agg(participant_id ORDER BY net_cents DESC, participant_id ASC), '{}'),
         COALESCE(array_agg(net_cents ORDER BY net_cents DESC, participant_id ASC), '{}')
    INTO v_creditor_ids, v_creditor_open
    FROM group_balances WHERE group_id = p_group_id AND net_cents > 0;

  WHILE v_di <= COALESCE(array_length(v_debtor_ids, 1), 0)
    AND v_ci <= COALESCE(array_length(v_creditor_ids, 1), 0) LOOP
    v_amount := LEAST(v_debtor_open[v_di], v_creditor_open[v_ci]);
    EXIT WHEN v_amount <= 0;
    from_kind := v_debtor_kinds[v_di];
    from_id := v_debtor_ids[v_di];
    to_id := v_creditor_ids[v_ci];
    amount_cents := v_amount;
    RETURN NEXT;
    v_debtor_open[v_di] := v_debtor_open[v_di] - v_amount;
    v_creditor_open[v_ci] := v_creditor_open[v_ci] - v_amount;
    IF v_debtor_open[v_di] <= 0 THEN v_di := v_di + 1; END IF;
    IF v_creditor_open[v_ci] <= 0 THEN v_ci := v_ci + 1; END IF;
  END LOOP;
END;
$$;
