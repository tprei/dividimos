-- validate_expense_payload accepted item descriptions of unlimited length, guest participants with an omitted or empty name, and participant entries with a missing or malformed id; descriptions are now capped at 240 code points matching the client limit, guest names are required, and participant ids must be canonical uuids
CREATE OR REPLACE FUNCTION public.validate_expense_payload(p jsonb, p_expense_type expense_type, p_total integer, p_fee_bps integer, p_fixed_fee integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                  WHERE k NOT IN ('description', 'quantityMilliunits', 'unitPriceCents', 'totalPriceCents'))
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
    IF jsonb_typeof(v_item->'description') = 'string' AND length(v_item->>'description') > 240 THEN
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
         OR jsonb_typeof(v_participant->'userId') IS DISTINCT FROM 'string'
         OR (v_participant->>'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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
         OR jsonb_typeof(v_participant->'displayName') IS DISTINCT FROM 'string'
         OR length(v_participant->>'displayName') < 1
         OR length(v_participant->>'displayName') > 80
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF v_participant ? 'guestId' AND jsonb_typeof(v_participant->'guestId') NOT IN ('null', 'string') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      IF jsonb_typeof(v_participant->'guestId') = 'string'
         AND (v_participant->>'guestId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN
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
    ) END,
    'splitMethod', to_jsonb(v_split_method)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_expense_payload(jsonb, expense_type, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_expense_payload(jsonb, expense_type, integer, integer, integer)
  TO service_role;
CREATE OR REPLACE FUNCTION public.resolve_expense_participants(p_expense_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      PERFORM assert_dm_pair_allowed(v_group_id, v_user_id);
      IF NOT is_member_or_invited(v_group_id, v_user_id)
         AND NOT COALESCE(v_user_id = ANY (v_existing_user_ids), false) THEN
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
$function$;

REVOKE ALL ON FUNCTION public.resolve_expense_participants(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_expense_participants(uuid, jsonb)
  TO service_role;
