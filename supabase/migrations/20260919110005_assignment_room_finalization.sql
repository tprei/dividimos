SET lock_timeout = '5s';

ALTER TABLE public.assignment_rooms
  DROP CONSTRAINT assignment_rooms_expense_id_fkey;
ALTER TABLE public.assignment_rooms
  ADD CONSTRAINT assignment_rooms_expense_id_fkey
    FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE
    NOT VALID;
ALTER TABLE public.assignment_rooms
  VALIDATE CONSTRAINT assignment_rooms_expense_id_fkey;

CREATE FUNCTION public.assignment_room_expense_payload(
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
      ) ORDER BY i.ordinal)
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

CREATE FUNCTION public.finalize_assignment_room(
  p_room_id uuid,
  p_expected_revision bigint,
  p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_preview public.assignment_rooms%ROWTYPE;
  v_room public.assignment_rooms%ROWTYPE;
  v_group_id uuid;
  v_group_result jsonb;
  v_host_participant_id uuid;
  v_subtotal bigint;
  v_service_fee bigint;
  v_total bigint;
  v_validated_payload jsonb;
  v_expected_payload jsonb;
  v_ack jsonb;
  v_expense_id uuid;
  v_existing_client_expense uuid;
  v_existing_group_id uuid;
  v_existing_status public.expense_status;
  v_existing_version integer;
  v_ledger_version bigint;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_expected_revision IS NULL
     OR p_expected_revision < 1 OR p_payload IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_preview
  FROM public.assignment_rooms
  WHERE id = p_room_id;
  IF NOT FOUND OR v_preview.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  PERFORM public.lock_receipt_key(v_actor, NULL);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('assignment-room-finalize:' || p_room_id::text, 0)
  );

  SELECT * INTO v_preview
  FROM public.assignment_rooms
  WHERE id = p_room_id;
  IF NOT FOUND OR v_preview.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  IF v_preview.status = 'finalized' THEN
    SELECT e.group_id INTO v_group_id
    FROM public.expenses e
    WHERE e.id = v_preview.expense_id
      AND e.client_id = p_room_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
    END IF;
  ELSIF v_preview.group_target->>'kind' = 'existing' THEN
    v_group_id := (v_preview.group_target->>'groupId')::uuid;
  ELSE
    v_group_result := public.create_group(
      v_preview.group_target->>'name',
      ARRAY[]::uuid[]
    );
    v_group_id := (v_group_result->>'groupId')::uuid;
  END IF;

  PERFORM public.lock_group(v_group_id);
  PERFORM public.assert_member(v_group_id, v_actor);

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND OR v_room.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  SELECT id INTO v_host_participant_id
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id
    AND user_id = v_actor
    AND removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  IF v_room.status = 'finalized' THEN
    SELECT e.id, e.group_id, e.status, e.current_version_no, g.ledger_version
    INTO v_expense_id, v_existing_group_id, v_existing_status,
         v_existing_version, v_ledger_version
    FROM public.expenses e
    JOIN public.groups g ON g.id = e.group_id
    WHERE e.id = v_room.expense_id
      AND e.client_id = p_room_id
      AND e.group_id = v_group_id;
    IF NOT FOUND OR v_existing_status = 'deleted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
    END IF;
    v_ack := jsonb_build_object(
      'expenseId', v_expense_id,
      'groupId', v_group_id,
      'versionNo', v_existing_version,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
    RETURN jsonb_build_object(
      'room', public.assignment_room_view(
        p_room_id, v_host_participant_id, true
      ),
      'ack', v_ack
    );
  END IF;
  IF v_room.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
  END IF;
  IF v_room.status <> 'closed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;
  IF v_room.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.assignment_room_items i
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(c.ticks), 0) AS claimed_ticks
      FROM public.assignment_room_claims c
      JOIN public.assignment_room_participants p
        ON p.room_id = c.room_id AND p.id = c.participant_id
      WHERE c.room_id = i.room_id
        AND c.item_id = i.id
        AND p.removed_at IS NULL
    ) claims ON true
    WHERE i.room_id = p_room_id
      AND claims.claimed_ticks <> i.quantity_milliunits::bigint * 120
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;

  SELECT id INTO v_existing_client_expense
  FROM public.expenses
  WHERE client_id = p_room_id;
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;

  SELECT sum(total_price_cents)::bigint INTO v_subtotal
  FROM public.assignment_room_items
  WHERE room_id = p_room_id;
  v_service_fee := floor((v_subtotal::numeric
    * (v_room.header->>'serviceFeeBasisPoints')::integer + 5000) / 10000);
  v_total := v_subtotal + v_service_fee
    + (v_room.header->>'fixedFeeCents')::integer;

  v_validated_payload := public.validate_expense_payload(
    p_payload,
    'itemized',
    v_total::integer,
    (v_room.header->>'serviceFeeBasisPoints')::integer,
    (v_room.header->>'fixedFeeCents')::integer
  );
  v_expected_payload := public.assignment_room_expense_payload(
    p_room_id,
    v_group_id,
    v_validated_payload->'payers'
  );
  IF v_validated_payload IS DISTINCT FROM v_expected_payload THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  v_ack := public.create_expense(
    p_room_id,
    v_group_id,
    (v_room.header->>'occurredOn')::date,
    v_room.header->>'title',
    NULL,
    'itemized',
    v_total::integer,
    (v_room.header->>'serviceFeeBasisPoints')::integer,
    (v_room.header->>'fixedFeeCents')::integer,
    v_validated_payload,
    NULL
  );
  v_expense_id := (v_ack->>'expenseId')::uuid;

  UPDATE public.assignment_room_participants p
  SET expense_participant_index = indexed.participant_index
  FROM (
    SELECT id,
           (row_number() OVER (ORDER BY ordinal) - 1)::integer AS participant_index
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id AND removed_at IS NULL
  ) indexed
  WHERE p.room_id = p_room_id AND p.id = indexed.id;

  UPDATE public.assignment_rooms
  SET expense_id = v_expense_id,
      status = 'finalized',
      revision = revision + 1
  WHERE id = p_room_id;

  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN jsonb_build_object(
    'room', public.assignment_room_view(
      p_room_id, v_host_participant_id, true
    ),
    'ack', v_ack
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assignment_room_expense_payload(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_assignment_room(uuid, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_assignment_room(uuid, bigint, jsonb)
  TO authenticated;
