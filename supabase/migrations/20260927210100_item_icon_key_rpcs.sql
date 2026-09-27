SET lock_timeout = '5s';

ALTER TABLE public.assignment_room_items VALIDATE CONSTRAINT assignment_room_items_icon_key;

CREATE OR REPLACE FUNCTION public.validate_expense_payload(p jsonb, p_expense_type expense_type, p_total integer, p_fee_bps integer, p_fixed_fee integer)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_items jsonb;
  v_participants jsonb;
  v_shares jsonb;
  v_split_method text;
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
  v_fee bigint;
  v_payer_indexes integer[];
  v_seen_user_ids uuid[];
  v_seen_guest_ids uuid[];
  v_user_id uuid;
  v_guest_id uuid;
  v_item_index integer;
  v_participant_index integer;
  v_amount integer;
  v_num numeric;
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
                 WHERE k NOT IN ('description', 'quantityMilliunits', 'unitPriceCents', 'totalPriceCents', 'icon'))
       OR NOT (v_item ? 'description' AND v_item ? 'quantityMilliunits' AND v_item ? 'unitPriceCents' AND v_item ? 'totalPriceCents')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF jsonb_typeof(v_item->'quantityMilliunits') <> 'number'
       OR (v_item->>'quantityMilliunits')::text <> floor((v_item->>'quantityMilliunits')::numeric)::text
       OR (v_item->>'quantityMilliunits')::numeric < 1
       OR (v_item->>'quantityMilliunits')::numeric > 999999999
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
    v_num := floor(((v_item->>'quantityMilliunits')::numeric
                    * (v_item->>'unitPriceCents')::numeric + 500) / 1000);
    IF v_num <> (v_item->>'totalPriceCents')::numeric THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'line_total_mismatch';
    END IF;
    IF v_item->'description' IS NOT NULL AND jsonb_typeof(v_item->'description') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF v_item ? 'icon' AND (
         jsonb_typeof(v_item->'icon') <> 'string'
         OR NOT (v_item->>'icon' ~ '^[a-z][a-z0-9_]{0,31}$')
       )
    THEN
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
    v_num := (v_shares->>v_i)::numeric;
    IF v_num < 0 OR v_num > 99999999 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_share := v_num::integer;
    v_share_sum := v_share_sum + v_share;
    v_i := v_i + 1;
  END LOOP;
  IF v_share_sum <> p_total THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'share_total_mismatch';
  END IF;

  -- How the author described the division ('equal', 'percentage', 'fixed').
  -- Cents remain authoritative; this only lets an edit reopen the control the
  -- author used instead of guessing from the amounts. Older versions have no
  -- such key and stay valid.
  IF p ? 'splitMethod' AND jsonb_typeof(p->'splitMethod') <> 'null' THEN
    IF jsonb_typeof(p->'splitMethod') <> 'string'
       OR (p->>'splitMethod') NOT IN ('equal', 'percentage', 'fixed')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_split_method := p->>'splitMethod';
  ELSE
    v_split_method := NULL;
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
    v_num := (v_payer->>'participantIndex')::numeric;
    IF v_num < 0 OR v_num >= jsonb_array_length(v_participants) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_participant_index := v_num::integer;
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
    v_num := (v_payer->>'amountCents')::numeric;
    IF v_num < 1 OR v_num > 99999999 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    v_amount := v_num::integer;
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
    -- 100 items x 50 participants is the structural maximum; without a cap the
    -- reconciliation below runs while lock_group is held.
    IF jsonb_array_length(v_item_assignments) > 5000 THEN
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
      v_num := (v_assignment->>'itemIndex')::numeric;
      IF v_num < 0 OR v_num >= jsonb_array_length(v_items) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_item_index := v_num::integer;
      v_num := (v_assignment->>'participantIndex')::numeric;
      IF v_num < 0 OR v_num >= jsonb_array_length(v_participants) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_participant_index := v_num::integer;
      IF jsonb_typeof(v_assignment->'amountCents') <> 'number'
         OR (v_assignment->>'amountCents')::text <> floor((v_assignment->>'amountCents')::numeric)::text
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_num := (v_assignment->>'amountCents')::numeric;
      IF v_num < 0 OR v_num > 99999999 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      v_amount := v_num::integer;
      v_i := v_i + 1;
    END LOOP;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_item_assignments) AS a(e)
      GROUP BY (a.e->>'itemIndex'), (a.e->>'participantIndex')
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF EXISTS (
      WITH assigned AS (
        SELECT (a.e->>'itemIndex')::integer AS item_index,
               sum((a.e->>'amountCents')::integer) AS assigned_cents
        FROM jsonb_array_elements(v_item_assignments) AS a(e)
        GROUP BY 1
      ), items AS (
        SELECT (ord - 1)::integer AS item_index,
               (x->>'totalPriceCents')::integer AS total_cents
        FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(x, ord)
      )
      SELECT 1 FROM items i
      FULL JOIN assigned a ON a.item_index = i.item_index
      WHERE COALESCE(a.assigned_cents, 0) <> COALESCE(i.total_cents, -1)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;
    IF EXISTS (
      WITH assigned AS (
        SELECT (a.e->>'participantIndex')::integer AS p_idx,
               sum((a.e->>'amountCents')::numeric) AS subtotal
        FROM jsonb_array_elements(v_item_assignments) AS a(e)
        GROUP BY 1
      ), parts AS (
        SELECT (ord - 1)::integer AS p_idx,
               (s->>0)::numeric AS share_cents,
               COALESCE(asg.subtotal, 0) AS item_subtotal
        FROM jsonb_array_elements(v_shares) WITH ORDINALITY AS t(s, ord)
        LEFT JOIN assigned asg ON asg.p_idx = (ord - 1)::integer
      ), fee_parts AS (
        SELECT p_idx, share_cents, item_subtotal,
               CASE WHEN v_item_sum = 0 THEN 0
                    ELSE floor((v_fee * item_subtotal) / v_item_sum) END AS fee_base,
               CASE WHEN v_item_sum = 0 THEN 0
                    ELSE (v_fee * item_subtotal) % v_item_sum END AS fee_rem
        FROM parts
      ), ranked AS (
        SELECT p_idx, share_cents, item_subtotal, fee_base,
               SUM(fee_base) OVER () AS fee_total,
               row_number() OVER (ORDER BY fee_rem DESC, p_idx ASC) AS rn
        FROM fee_parts
      )
      SELECT 1 FROM ranked
      WHERE item_subtotal
              + fee_base
              + CASE WHEN rn <= CASE WHEN v_item_sum = 0 THEN 0
                                ELSE v_fee - fee_total END
                THEN 1 ELSE 0 END
              + (p_fixed_fee / jsonb_array_length(v_shares))
              + CASE WHEN p_idx < (p_fixed_fee % jsonb_array_length(v_shares))
                THEN 1 ELSE 0 END
            <> share_cents
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'item_assignment_share_mismatch';
    END IF;
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
      ) || CASE WHEN x ? 'icon'
            THEN jsonb_build_object('icon', x->>'icon')
            ELSE '{}'::jsonb
          END
      ORDER BY ord), '[]'::jsonb)
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
    ) END,
    'splitMethod', to_jsonb(v_split_method)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_expense_payload(jsonb, expense_type, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

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
             OR NOT (v_item->>'icon' ~ '^[a-z][a-z0-9_]{0,31}$')
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

REVOKE ALL ON FUNCTION public.validate_assignment_room_receipt(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_assignment_room_receipt(jsonb, jsonb) TO service_role;

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
         item->>'icon'
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

REVOKE ALL ON FUNCTION public.create_assignment_room(uuid, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_assignment_room(uuid, jsonb, jsonb, jsonb, jsonb, text) TO authenticated;

DROP TYPE public.expense_item_icon;
