-- a group member in a blocked pair with the host finalizes as a guest slot even when the block formed after they entered the room, matching the host view, and only members outside the pair or already in the room receive its live summaries, matching the room list
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
              AND NOT EXISTS (
                SELECT 1
                FROM public.assignment_rooms r
                JOIN public.user_blocks b
                  ON (b.blocker_id = p.user_id AND b.blocked_id = r.host_user_id)
                  OR (b.blocker_id = r.host_user_id AND b.blocked_id = p.user_id)
                WHERE r.id = p_room_id
              )
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

REVOKE ALL ON FUNCTION public.assignment_room_expense_payload(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.broadcast_assignment_room(
  p_room_id uuid,
  p_event text DEFAULT 'assignment',
  p_topic text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_revision bigint;
  v_host uuid;
  v_topic text;
  v_current_topic text;
  v_summary jsonb;
  v_rec record;
BEGIN
  SELECT r.revision, r.host_user_id, a.broadcast_topic
  INTO v_revision, v_host, v_current_topic
  FROM public.assignment_rooms r
  JOIN guest_credentials.assignment_room_access a ON a.room_id = r.id
  WHERE r.id = p_room_id;

  IF NOT FOUND OR v_current_topic IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;

  v_topic := COALESCE(p_topic, v_current_topic);
  PERFORM realtime.send(
    jsonb_build_object('revision', v_revision),
    CASE WHEN p_event = 'access_changed' THEN 'access_changed' ELSE 'assignment' END,
    v_topic,
    true
  );

  IF p_event = 'access_changed' AND v_topic <> v_current_topic THEN
    PERFORM realtime.send(
      jsonb_build_object('revision', v_revision),
      'assignment',
      v_current_topic,
      true
    );
  END IF;

  v_summary := public.assignment_room_summary_json(p_room_id);
  IF v_summary->>'groupId' IS NOT NULL THEN
    FOR v_rec IN
      SELECT gm.user_id
      FROM public.group_members gm
      WHERE gm.group_id = (v_summary->>'groupId')::uuid
        AND gm.status = 'accepted'
        AND NOT (
          EXISTS (
            SELECT 1 FROM public.user_blocks b
            WHERE (b.blocker_id = gm.user_id AND b.blocked_id = v_host)
               OR (b.blocker_id = v_host AND b.blocked_id = gm.user_id)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.assignment_room_participants p
            WHERE p.room_id = p_room_id
              AND p.user_id = gm.user_id
              AND p.removed_at IS NULL
          )
        )
      FOR SHARE OF gm
    LOOP
      PERFORM realtime.send(
        jsonb_build_object('room', v_summary),
        'assignment_room',
        'user:' || v_rec.user_id::text,
        true
      );
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  TO service_role;
