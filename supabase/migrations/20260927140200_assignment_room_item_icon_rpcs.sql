CREATE OR REPLACE FUNCTION public.validate_assignment_room_receipt(
  p_header jsonb,
  p_items jsonb
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_header jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_title text;
  v_occurred_on date;
  v_fee_bps integer;
  v_fixed_fee integer;
  v_quantity integer;
  v_unit_price integer;
  v_line_total integer;
  v_subtotal bigint := 0;
  v_grand_total bigint;
  v_index integer;
BEGIN
  IF p_header IS NULL OR jsonb_typeof(p_header) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_header)) <> 4
     OR NOT (p_header ?& ARRAY['title', 'occurredOn', 'serviceFeeBasisPoints', 'fixedFeeCents'])
     OR jsonb_typeof(p_header->'title') <> 'string'
     OR jsonb_typeof(p_header->'occurredOn') <> 'string'
     OR jsonb_typeof(p_header->'serviceFeeBasisPoints') <> 'number'
     OR jsonb_typeof(p_header->'fixedFeeCents') <> 'number'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_title := btrim(p_header->>'title');
  IF length(v_title) NOT BETWEEN 1 AND 160
     OR (p_header->>'occurredOn') !~ '^\d{4}-\d{2}-\d{2}$'
     OR (p_header->>'serviceFeeBasisPoints')::numeric <> floor((p_header->>'serviceFeeBasisPoints')::numeric)
     OR (p_header->>'fixedFeeCents')::numeric <> floor((p_header->>'fixedFeeCents')::numeric)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  BEGIN
    v_occurred_on := (p_header->>'occurredOn')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END;

  v_fee_bps := (p_header->>'serviceFeeBasisPoints')::integer;
  v_fixed_fee := (p_header->>'fixedFeeCents')::integer;
  IF v_fee_bps NOT BETWEEN 0 AND 10000 OR v_fixed_fee NOT BETWEEN 0 AND 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  FOR v_index IN 0..jsonb_array_length(p_items) - 1 LOOP
    v_item := p_items->v_index;
    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_item) k WHERE k <> 'icon') <> 4
       OR NOT (v_item ?& ARRAY['description', 'quantityMilliunits', 'unitPriceCents', 'totalPriceCents'])
       OR jsonb_typeof(v_item->'description') <> 'string'
       OR jsonb_typeof(v_item->'quantityMilliunits') <> 'number'
       OR jsonb_typeof(v_item->'unitPriceCents') <> 'number'
       OR jsonb_typeof(v_item->'totalPriceCents') <> 'number'
       OR length(btrim(v_item->>'description')) NOT BETWEEN 1 AND 240
       OR (v_item->>'quantityMilliunits')::numeric <> floor((v_item->>'quantityMilliunits')::numeric)
       OR (v_item->>'unitPriceCents')::numeric <> floor((v_item->>'unitPriceCents')::numeric)
       OR (v_item->>'totalPriceCents')::numeric <> floor((v_item->>'totalPriceCents')::numeric)
       OR (v_item ? 'icon' AND (
             jsonb_typeof(v_item->'icon') <> 'string'
             OR NOT (v_item->>'icon' = ANY (enum_range(NULL::public.expense_item_icon)::text[]))
          ))
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    v_quantity := (v_item->>'quantityMilliunits')::integer;
    v_unit_price := (v_item->>'unitPriceCents')::integer;
    v_line_total := (v_item->>'totalPriceCents')::integer;
    IF v_quantity NOT BETWEEN 1 AND 999999999
       OR v_unit_price NOT BETWEEN 0 AND 99999999
       OR v_line_total NOT BETWEEN 0 AND 99999999
       OR floor((v_quantity::numeric * v_unit_price::numeric + 500) / 1000) <> v_line_total
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    v_subtotal := v_subtotal + v_line_total;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'description', btrim(v_item->>'description'),
      'quantityMilliunits', v_quantity,
      'unitPriceCents', v_unit_price,
      'totalPriceCents', v_line_total
    ) || CASE WHEN v_item ? 'icon'
          THEN jsonb_build_object('icon', v_item->>'icon')
          ELSE '{}'::jsonb
        END);
  END LOOP;

  v_grand_total := v_subtotal + floor((v_subtotal::numeric * v_fee_bps + 5000) / 10000) + v_fixed_fee;
  IF v_subtotal < 1 OR v_grand_total NOT BETWEEN 1 AND 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_header := jsonb_build_object(
    'title', v_title,
    'occurredOn', to_char(v_occurred_on, 'YYYY-MM-DD'),
    'serviceFeeBasisPoints', v_fee_bps,
    'fixedFeeCents', v_fixed_fee
  );
  RETURN jsonb_build_object('header', v_header, 'items', v_items);
EXCEPTION
  WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
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
      ) || CASE WHEN i.icon IS NULL
            THEN '{}'::jsonb
            ELSE jsonb_build_object('icon', i.icon)
          END
      ORDER BY i.ordinal)
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

CREATE OR REPLACE FUNCTION public.create_assignment_room(
  p_room_id uuid,
  p_group_target jsonb,
  p_header jsonb,
  p_items jsonb,
  p_participants jsonb,
  p_join_token text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_receipt jsonb;
  v_group_target jsonb;
  v_group_id uuid;
  v_group_kind public.group_kind;
  v_participants jsonb := '[]'::jsonb;
  v_participant jsonb;
  v_participant_id uuid;
  v_user_id uuid;
  v_display_name text;
  v_profile_name text;
  v_host_participant_id uuid;
  v_index integer;
  v_join_digest bytea;
  v_topic text;
  v_existing public.assignment_rooms%ROWTYPE;
  v_stored_items jsonb;
  v_stored_participants jsonb;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_join_token IS NULL
     OR p_join_token !~ '^armj1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  v_join_digest := extensions.digest(convert_to(p_join_token, 'UTF8'), 'sha256');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_room_id::text, 110001));
  v_receipt := public.validate_assignment_room_receipt(p_header, p_items);

  IF p_group_target IS NULL OR jsonb_typeof(p_group_target) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_group_target)) <> 2
     OR jsonb_typeof(p_group_target->'kind') <> 'string'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_group_target->>'kind' = 'existing' THEN
    IF NOT (p_group_target ? 'groupId') OR jsonb_typeof(p_group_target->'groupId') <> 'string'
       OR (p_group_target->>'groupId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_group_id := (p_group_target->>'groupId')::uuid;
    SELECT kind INTO v_group_kind FROM public.groups WHERE id = v_group_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_not_found';
    END IF;
    IF v_group_kind = 'dm' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
    END IF;
    PERFORM public.assert_member(v_group_id, v_actor);
    v_group_target := jsonb_build_object('kind', 'existing', 'groupId', v_group_id);
  ELSIF p_group_target->>'kind' = 'new' THEN
    IF NOT (p_group_target ? 'name') OR jsonb_typeof(p_group_target->'name') <> 'string'
       OR length(btrim(p_group_target->>'name')) NOT BETWEEN 1 AND 80
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_group_target := jsonb_build_object('kind', 'new', 'name', btrim(p_group_target->>'name'));
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_participants IS NULL OR jsonb_typeof(p_participants) <> 'array'
     OR jsonb_array_length(p_participants) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  FOR v_index IN 0..jsonb_array_length(p_participants) - 1 LOOP
    v_participant := p_participants->v_index;
    IF v_participant IS NULL OR jsonb_typeof(v_participant) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_participant)) <> 3
       OR NOT (v_participant ?& ARRAY['id', 'displayName', 'userId'])
       OR jsonb_typeof(v_participant->'id') <> 'string'
       OR (v_participant->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_participant->'displayName') <> 'string'
       OR length(btrim(v_participant->>'displayName')) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(v_participant->'userId') NOT IN ('string', 'null')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    v_participant_id := (v_participant->>'id')::uuid;
    v_display_name := btrim(v_participant->>'displayName');
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_participants) p
      WHERE p->>'id' = v_participant_id::text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    IF jsonb_typeof(v_participant->'userId') = 'string' THEN
      IF (v_participant->>'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      v_user_id := (v_participant->>'userId')::uuid;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_participants) p
        WHERE p->>'userId' = v_user_id::text
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      SELECT name INTO v_profile_name FROM public.users WHERE id = v_user_id;
      IF NOT FOUND OR v_display_name <> v_profile_name THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
      END IF;
    ELSE
      v_user_id := NULL;
    END IF;

    IF v_index = 0 THEN
      IF v_user_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      v_host_participant_id := v_participant_id;
    ELSIF v_user_id = v_actor THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    v_participants := v_participants || jsonb_build_array(jsonb_build_object(
      'id', v_participant_id,
      'displayName', v_display_name,
      'userId', v_user_id
    ));
  END LOOP;

  SELECT * INTO v_existing FROM public.assignment_rooms WHERE id = p_room_id FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'description', description,
      'quantityMilliunits', quantity_milliunits,
      'unitPriceCents', unit_price_cents,
      'totalPriceCents', total_price_cents
    ) || CASE WHEN icon IS NULL
          THEN '{}'::jsonb
          ELSE jsonb_build_object('icon', icon)
        END
    ORDER BY ordinal), '[]'::jsonb)
    INTO v_stored_items FROM public.assignment_room_items WHERE room_id = p_room_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'displayName', display_name,
      'userId', user_id
    ) ORDER BY ordinal), '[]'::jsonb)
    INTO v_stored_participants FROM public.assignment_room_participants WHERE room_id = p_room_id;

    IF v_existing.host_user_id IS DISTINCT FROM v_actor
       OR v_existing.group_target IS DISTINCT FROM v_group_target
       OR v_existing.header IS DISTINCT FROM v_receipt->'header'
       OR v_stored_items IS DISTINCT FROM v_receipt->'items'
       OR v_stored_participants IS DISTINCT FROM v_participants
       OR NOT EXISTS (
         SELECT 1 FROM guest_credentials.assignment_room_access a
         WHERE a.room_id = p_room_id AND a.join_digest = v_join_digest
       )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
  END IF;

  INSERT INTO public.assignment_rooms (id, host_user_id, group_target, header)
  VALUES (p_room_id, v_actor, v_group_target, v_receipt->'header');

  INSERT INTO public.assignment_room_items (
    room_id, id, ordinal, description, quantity_milliunits, unit_price_cents, total_price_cents, icon
  )
  SELECT p_room_id, gen_random_uuid(), ordinality - 1,
         item->>'description',
         (item->>'quantityMilliunits')::integer,
         (item->>'unitPriceCents')::integer,
         (item->>'totalPriceCents')::integer,
         (item->>'icon')::public.expense_item_icon
  FROM jsonb_array_elements(v_receipt->'items') WITH ORDINALITY AS rows(item, ordinality);

  INSERT INTO public.assignment_room_participants (room_id, id, ordinal, display_name, user_id)
  SELECT p_room_id,
         (participant->>'id')::uuid,
         ordinality - 1,
         participant->>'displayName',
         CASE WHEN jsonb_typeof(participant->'userId') = 'string'
              THEN (participant->>'userId')::uuid ELSE NULL END
  FROM jsonb_array_elements(v_participants) WITH ORDINALITY AS rows(participant, ordinality);

  v_topic := 'assignment-room:' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  INSERT INTO guest_credentials.assignment_room_access (room_id, join_digest, join_expires_at, broadcast_topic)
  VALUES (p_room_id, v_join_digest, now() + interval '7 days', v_topic);

  RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
EXCEPTION
  WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
END;
$$;

CREATE OR REPLACE FUNCTION public.assignment_room_expense_payload(
  p_room_id uuid,
  p_group_id uuid,
  p_payers jsonb
) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  WITH active AS (
    SELECT p.id,
           p.ordinal,
           p.display_name,
           p.user_id,
           (row_number() OVER (ORDER BY p.ordinal) - 1)::integer AS participant_index,
           CASE
             WHEN p.user_id IS NOT NULL
              AND public.is_member_or_invited(p_group_id, p.user_id)
             THEN jsonb_build_object('kind', 'user', 'userId', p.user_id)
             ELSE jsonb_build_object(
               'kind', 'guest',
               'guestId', NULL,
               'displayName', p.display_name
             )
           END AS participant_ref
    FROM public.assignment_room_participants p
    WHERE p.room_id = p_room_id AND p.removed_at IS NULL
  ), ordered_items AS (
    SELECT i.*,
           row_number() OVER (ORDER BY i.ordinal) - 1 AS item_index,
           i.quantity_milliunits::bigint * 120 AS capacity_ticks
    FROM public.assignment_room_items i
    WHERE i.room_id = p_room_id
  ), allocation_bases AS (
    SELECT i.item_index,
           i.total_price_cents,
           a.participant_index,
           a.ordinal AS participant_ordinal,
           floor(i.total_price_cents::numeric * c.ticks / i.capacity_ticks)::bigint AS base_cents,
           mod(i.total_price_cents::numeric * c.ticks, i.capacity_ticks)::bigint AS remainder
    FROM ordered_items i
    JOIN public.assignment_room_claims c
      ON c.room_id = i.room_id AND c.item_id = i.id
    JOIN active a ON a.id = c.participant_id
  ), allocation_ranked AS (
    SELECT b.*,
           sum(b.base_cents) OVER (PARTITION BY b.item_index) AS base_total,
           row_number() OVER (
             PARTITION BY b.item_index
             ORDER BY b.remainder DESC, b.participant_ordinal
           ) AS remainder_rank
    FROM allocation_bases b
  ), allocations AS (
    SELECT item_index,
           participant_index,
           base_cents + CASE
             WHEN remainder_rank <= total_price_cents - base_total THEN 1
             ELSE 0
           END AS amount_cents
    FROM allocation_ranked
  ), item_shares AS (
    SELECT a.participant_index,
           COALESCE(sum(x.amount_cents), 0)::bigint AS item_cents
    FROM active a
    LEFT JOIN allocations x ON x.participant_index = a.participant_index
    GROUP BY a.participant_index
  ), totals AS (
    SELECT sum(i.total_price_cents)::bigint AS subtotal_cents,
           floor((sum(i.total_price_cents)::numeric
             * (r.header->>'serviceFeeBasisPoints')::integer + 5000) / 10000)::bigint AS service_fee_cents,
           (r.header->>'fixedFeeCents')::bigint AS fixed_fee_cents,
           (SELECT count(*) FROM active)::bigint AS participant_count
    FROM public.assignment_rooms r
    JOIN ordered_items i ON true
    WHERE r.id = p_room_id
    GROUP BY r.header
  ), fee_bases AS (
    SELECT s.participant_index,
           s.item_cents,
           t.service_fee_cents,
           t.fixed_fee_cents,
           t.participant_count,
           floor(t.service_fee_cents::numeric * s.item_cents / t.subtotal_cents)::bigint AS fee_base,
           mod(t.service_fee_cents::numeric * s.item_cents, t.subtotal_cents)::bigint AS fee_remainder
    FROM item_shares s
    CROSS JOIN totals t
  ), fee_ranked AS (
    SELECT f.*,
           sum(f.fee_base) OVER () AS fee_base_total,
           row_number() OVER (
             ORDER BY f.fee_remainder DESC, f.participant_index
           ) AS fee_rank
    FROM fee_bases f
  ), shares AS (
    SELECT participant_index,
           item_cents
             + fee_base
             + CASE
                 WHEN fee_rank <= service_fee_cents - fee_base_total THEN 1
                 ELSE 0
               END
             + fixed_fee_cents / participant_count
             + CASE
                 WHEN participant_index < fixed_fee_cents % participant_count THEN 1
                 ELSE 0
               END AS share_cents
    FROM fee_ranked
  )
  SELECT jsonb_build_object(
    'items', (
      SELECT jsonb_agg(jsonb_build_object(
        'description', i.description,
        'quantityMilliunits', i.quantity_milliunits,
        'unitPriceCents', i.unit_price_cents,
        'totalPriceCents', i.total_price_cents
      ) || CASE WHEN i.icon IS NULL
            THEN '{}'::jsonb
            ELSE jsonb_build_object('icon', i.icon)
          END
      ORDER BY i.ordinal)
      FROM ordered_items i
    ),
    'participants', (
      SELECT jsonb_agg(a.participant_ref ORDER BY a.ordinal)
      FROM active a
    ),
    'shares', (
      SELECT jsonb_agg(s.share_cents ORDER BY s.participant_index)
      FROM shares s
    ),
    'payers', p_payers,
    'itemAssignments', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'itemIndex', x.item_index,
        'participantIndex', x.participant_index,
        'amountCents', x.amount_cents
      ) ORDER BY x.item_index, x.participant_index), '[]'::jsonb)
      FROM allocations x
      WHERE x.amount_cents > 0
    ),
    'splitMethod', NULL
  );
$$;

REVOKE ALL ON FUNCTION public.validate_assignment_room_receipt(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assignment_room_view(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_assignment_room(uuid, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assignment_room_expense_payload(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validate_assignment_room_receipt(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.assignment_room_view(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_assignment_room(uuid, jsonb, jsonb, jsonb, jsonb, text) TO authenticated;
