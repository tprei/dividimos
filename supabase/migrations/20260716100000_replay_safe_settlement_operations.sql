CREATE TABLE public.settlement_operations (
  id uuid PRIMARY KEY,
  initiated_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  canonical_request jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.settlement_operation_items (
  operation_id uuid NOT NULL REFERENCES public.settlement_operations(id) ON DELETE CASCADE,
  allocation_index integer NOT NULL CHECK (allocation_index >= 0),
  settlement_id uuid NOT NULL UNIQUE REFERENCES public.settlements(id) ON DELETE CASCADE,
  PRIMARY KEY (operation_id, allocation_index)
);

ALTER TABLE public.settlement_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_operation_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.settlement_operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.settlement_operation_items FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX chat_messages_system_settlement_settlement_id_unique
  ON public.chat_messages (settlement_id)
  WHERE message_type = 'system_settlement'
    AND settlement_id IS NOT NULL;

CREATE FUNCTION public.record_settlements(
  p_operation_id uuid,
  p_allocations jsonb
)
RETURNS TABLE (
  allocation_index integer,
  settlement_id uuid,
  group_id uuid,
  from_user_id uuid,
  to_user_id uuid,
  amount_cents integer,
  status public.settlement_status,
  created_at timestamptz,
  confirmed_at timestamptz,
  was_replay boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_element jsonb;
  v_keys text[];
  v_normalized jsonb := '[]'::jsonb;
  v_canonical_request jsonb;
  v_operation_id uuid;
  v_existing_operation RECORD;
  v_group_id uuid;
  v_locked_group RECORD;
  v_allocation RECORD;
  v_counterparty uuid;
  v_item_count integer;
  v_settlement RECORD;
  v_user_a uuid;
  v_user_b uuid;
  v_delta integer;
  v_amount_numeric numeric;
  v_amount_cents integer;
  v_is_dm boolean;
  v_is_replay boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  IF jsonb_typeof(p_allocations) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'invalid_settlement_batch' USING ERRCODE = 'PST11';
  END IF;

  FOR v_element IN
    SELECT value
      FROM jsonb_array_elements(p_allocations)
  LOOP
    IF jsonb_typeof(v_element) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_settlement_batch' USING ERRCODE = 'PST11';
    END IF;

    SELECT array_agg(key ORDER BY key)
      INTO v_keys
      FROM jsonb_object_keys(v_element) AS key;

    IF v_keys IS DISTINCT FROM ARRAY[
      'amount_cents',
      'from_user_id',
      'group_id',
      'to_user_id'
    ] THEN
      RAISE EXCEPTION 'invalid_settlement_batch' USING ERRCODE = 'PST11';
    END IF;

    IF jsonb_typeof(v_element -> 'group_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_element -> 'from_user_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_element -> 'to_user_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_element -> 'amount_cents') IS DISTINCT FROM 'number'
      OR (v_element ->> 'group_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (v_element ->> 'from_user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (v_element ->> 'to_user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid_settlement_batch' USING ERRCODE = 'PST11';
    END IF;

    v_amount_numeric := (v_element ->> 'amount_cents')::numeric;
    IF v_amount_numeric <> trunc(v_amount_numeric)
      OR v_amount_numeric < -2147483648
      OR v_amount_numeric > 2147483647 THEN
      RAISE EXCEPTION 'invalid_settlement_batch' USING ERRCODE = 'PST11';
    END IF;

    v_amount_cents := v_amount_numeric::integer;
    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object(
        'group_id', (v_element ->> 'group_id')::uuid,
        'from_user_id', (v_element ->> 'from_user_id')::uuid,
        'to_user_id', (v_element ->> 'to_user_id')::uuid,
        'amount_cents', v_amount_cents
      )
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM jsonb_to_recordset(v_normalized) AS allocation(
        group_id uuid,
        from_user_id uuid,
        to_user_id uuid,
        amount_cents integer
      )
     GROUP BY allocation.group_id, allocation.from_user_id, allocation.to_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'invalid_settlement_batch' USING ERRCODE = 'PST11';
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'group_id', allocation.group_id,
             'from_user_id', allocation.from_user_id,
             'to_user_id', allocation.to_user_id,
             'amount_cents', allocation.amount_cents
           )
           ORDER BY
             allocation.group_id,
             allocation.from_user_id,
             allocation.to_user_id,
             allocation.amount_cents
         )
    INTO v_canonical_request
    FROM jsonb_to_recordset(v_normalized) AS allocation(
      group_id uuid,
      from_user_id uuid,
      to_user_id uuid,
      amount_cents integer
    );

  v_item_count := jsonb_array_length(v_canonical_request);

  INSERT INTO public.settlement_operations (
    id,
    initiated_by,
    canonical_request
  )
  VALUES (
    p_operation_id,
    v_caller,
    v_canonical_request
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_operation_id;

  IF v_operation_id IS NULL THEN
    SELECT initiated_by, canonical_request
      INTO v_existing_operation
      FROM public.settlement_operations
     WHERE id = p_operation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
    END IF;

    IF v_existing_operation.initiated_by IS DISTINCT FROM v_caller
      OR v_existing_operation.canonical_request IS DISTINCT FROM v_canonical_request THEN
      RAISE EXCEPTION 'settlement_operation_conflict' USING ERRCODE = 'PST10';
    END IF;

    v_is_replay := true;
  ELSE
    FOR v_group_id IN
      SELECT DISTINCT (element.value ->> 'group_id')::uuid AS group_id
        FROM jsonb_array_elements(v_canonical_request) AS element(value)
       ORDER BY group_id
    LOOP
      SELECT g.id, g.is_dm
        INTO v_locked_group
        FROM public.groups AS g
       WHERE g.id = v_group_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
      END IF;
    END LOOP;

    FOR v_allocation IN
      SELECT
        (element.ordinality - 1)::integer AS allocation_index,
        (element.value ->> 'group_id')::uuid AS group_id,
        (element.value ->> 'from_user_id')::uuid AS from_user_id,
        (element.value ->> 'to_user_id')::uuid AS to_user_id,
        (element.value ->> 'amount_cents')::integer AS amount_cents
      FROM jsonb_array_elements(v_canonical_request)
        WITH ORDINALITY AS element(value, ordinality)
      ORDER BY element.ordinality
    LOOP
      IF v_caller <> v_allocation.from_user_id
        AND v_caller <> v_allocation.to_user_id THEN
        RAISE EXCEPTION 'permission_denied: caller must be debtor or creditor' USING ERRCODE = 'PST05';
      END IF;

      IF v_allocation.group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN
        RAISE EXCEPTION 'permission_denied: not a group member' USING ERRCODE = 'PST05';
      END IF;

      IF v_allocation.amount_cents <= 0
        OR v_allocation.amount_cents > 10000000 THEN
        RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'PST13';
      END IF;

      IF v_allocation.from_user_id = v_allocation.to_user_id THEN
        RAISE EXCEPTION 'invalid_users' USING ERRCODE = 'PST14';
      END IF;

      v_counterparty := CASE
        WHEN v_caller = v_allocation.from_user_id THEN v_allocation.to_user_id
        ELSE v_allocation.from_user_id
      END;

      IF NOT EXISTS (
        SELECT 1
          FROM public.group_members AS member
         WHERE member.group_id = v_allocation.group_id
           AND member.user_id = v_counterparty
      ) AND NOT EXISTS (
        SELECT 1
          FROM public.groups
         WHERE id = v_allocation.group_id
           AND creator_id = v_counterparty
      ) THEN
        RAISE EXCEPTION 'permission_denied: counterparty is not a group member' USING ERRCODE = 'PST05';
      END IF;
    END LOOP;

    FOR v_allocation IN
      SELECT
        (element.ordinality - 1)::integer AS allocation_index,
        (element.value ->> 'group_id')::uuid AS group_id,
        (element.value ->> 'from_user_id')::uuid AS from_user_id,
        (element.value ->> 'to_user_id')::uuid AS to_user_id,
        (element.value ->> 'amount_cents')::integer AS amount_cents
      FROM jsonb_array_elements(v_canonical_request)
        WITH ORDINALITY AS element(value, ordinality)
      ORDER BY
        (element.value ->> 'group_id')::uuid,
        LEAST(
          (element.value ->> 'from_user_id')::uuid,
          (element.value ->> 'to_user_id')::uuid
        ),
        GREATEST(
          (element.value ->> 'from_user_id')::uuid,
          (element.value ->> 'to_user_id')::uuid
        ),
        (element.value ->> 'from_user_id')::uuid,
        (element.value ->> 'to_user_id')::uuid,
        (element.value ->> 'amount_cents')::integer
    LOOP
      SELECT is_dm
        INTO v_is_dm
        FROM public.groups
       WHERE id = v_allocation.group_id;

      INSERT INTO public.settlements AS settlement (
        group_id,
        from_user_id,
        to_user_id,
        amount_cents,
        status,
        created_at,
        confirmed_at
      )
      VALUES (
        v_allocation.group_id,
        v_allocation.from_user_id,
        v_allocation.to_user_id,
        v_allocation.amount_cents,
        'confirmed',
        now(),
        now()
      )
      RETURNING settlement.id, settlement.created_at, settlement.confirmed_at
        INTO v_settlement;

      IF v_allocation.from_user_id < v_allocation.to_user_id THEN
        v_user_a := v_allocation.from_user_id;
        v_user_b := v_allocation.to_user_id;
        v_delta := -v_allocation.amount_cents;
      ELSE
        v_user_a := v_allocation.to_user_id;
        v_user_b := v_allocation.from_user_id;
        v_delta := v_allocation.amount_cents;
      END IF;

      INSERT INTO public.balances (
        group_id,
        user_a,
        user_b,
        amount_cents
      )
      VALUES (
        v_allocation.group_id,
        v_user_a,
        v_user_b,
        v_delta
      )
      ON CONFLICT ON CONSTRAINT balances_pkey
      DO UPDATE SET
        amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
        updated_at = now();

      IF v_is_dm THEN
        INSERT INTO public.chat_messages (
          group_id,
          sender_id,
          message_type,
          content,
          settlement_id
        )
        VALUES (
          v_allocation.group_id,
          v_caller,
          'system_settlement',
          '',
          v_settlement.id
        );
      END IF;

      INSERT INTO public.settlement_operation_items (
        operation_id,
        allocation_index,
        settlement_id
      )
      VALUES (
        p_operation_id,
        v_allocation.allocation_index,
        v_settlement.id
      );
    END LOOP;
  END IF;

  IF (
    SELECT count(*)
      FROM public.settlement_operation_items
     WHERE operation_id = p_operation_id
  ) <> v_item_count
    OR EXISTS (
      SELECT 1
        FROM generate_series(0, v_item_count - 1) AS expected(allocation_index)
       WHERE NOT EXISTS (
         SELECT 1
           FROM public.settlement_operation_items AS item
          WHERE item.operation_id = p_operation_id
            AND item.allocation_index = expected.allocation_index
       )
    )
    OR EXISTS (
      SELECT 1
        FROM public.settlement_operation_items AS item
       WHERE item.operation_id = p_operation_id
         AND item.allocation_index >= v_item_count
    ) THEN
    RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
  END IF;

  FOR v_allocation IN
    SELECT
      (element.ordinality - 1)::integer AS allocation_index,
      (element.value ->> 'group_id')::uuid AS group_id,
      (element.value ->> 'from_user_id')::uuid AS from_user_id,
      (element.value ->> 'to_user_id')::uuid AS to_user_id,
      (element.value ->> 'amount_cents')::integer AS amount_cents
    FROM jsonb_array_elements(v_canonical_request)
      WITH ORDINALITY AS element(value, ordinality)
    ORDER BY element.ordinality
  LOOP
    SELECT
      s.id,
      s.group_id,
      s.from_user_id,
      s.to_user_id,
      s.amount_cents,
      s.status,
      s.created_at,
      s.confirmed_at
      INTO v_settlement
      FROM public.settlement_operation_items AS item
      JOIN public.settlements AS s
        ON s.id = item.settlement_id
     WHERE item.operation_id = p_operation_id
       AND item.allocation_index = v_allocation.allocation_index;

    IF NOT FOUND
      OR v_settlement.group_id IS DISTINCT FROM v_allocation.group_id
      OR v_settlement.from_user_id IS DISTINCT FROM v_allocation.from_user_id
      OR v_settlement.to_user_id IS DISTINCT FROM v_allocation.to_user_id
      OR v_settlement.amount_cents IS DISTINCT FROM v_allocation.amount_cents
      OR v_settlement.status IS DISTINCT FROM 'confirmed'::public.settlement_status
      OR v_settlement.created_at IS NULL
      OR v_settlement.confirmed_at IS NULL THEN
      RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
    END IF;

    RETURN QUERY
      SELECT
        v_allocation.allocation_index,
        v_settlement.id,
        v_settlement.group_id,
        v_settlement.from_user_id,
        v_settlement.to_user_id,
        v_settlement.amount_cents,
        v_settlement.status,
        v_settlement.created_at,
        v_settlement.confirmed_at,
        v_is_replay;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_settlements(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_settlements(uuid, jsonb) TO authenticated;

CREATE FUNCTION public.get_settlement_operation(
  p_operation_id uuid
)
RETURNS TABLE (
  allocation_index integer,
  settlement_id uuid,
  group_id uuid,
  from_user_id uuid,
  to_user_id uuid,
  amount_cents integer,
  status public.settlement_status,
  created_at timestamptz,
  confirmed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_operation RECORD;
  v_element jsonb;
  v_keys text[];
  v_normalized jsonb := '[]'::jsonb;
  v_amount_numeric numeric;
  v_amount_cents integer;
  v_item_count integer;
  v_allocation RECORD;
  v_settlement RECORD;
BEGIN
  SELECT initiated_by, canonical_request
    INTO v_operation
    FROM public.settlement_operations
   WHERE id = p_operation_id;

  IF NOT FOUND OR v_operation.initiated_by IS DISTINCT FROM v_caller THEN
    RETURN;
  END IF;

  IF jsonb_typeof(v_operation.canonical_request) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_operation.canonical_request) = 0 THEN
    RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
  END IF;

  FOR v_element IN
    SELECT value
      FROM jsonb_array_elements(v_operation.canonical_request)
  LOOP
    IF jsonb_typeof(v_element) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
    END IF;

    SELECT array_agg(key ORDER BY key)
      INTO v_keys
      FROM jsonb_object_keys(v_element) AS key;

    IF v_keys IS DISTINCT FROM ARRAY[
      'amount_cents',
      'from_user_id',
      'group_id',
      'to_user_id'
    ]
      OR jsonb_typeof(v_element -> 'group_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_element -> 'from_user_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_element -> 'to_user_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_element -> 'amount_cents') IS DISTINCT FROM 'number'
      OR (v_element ->> 'group_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (v_element ->> 'from_user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (v_element ->> 'to_user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
    END IF;

    v_amount_numeric := (v_element ->> 'amount_cents')::numeric;
    IF v_amount_numeric <> trunc(v_amount_numeric)
      OR v_amount_numeric < -2147483648
      OR v_amount_numeric > 2147483647 THEN
      RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
    END IF;

    v_amount_cents := v_amount_numeric::integer;
    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object(
        'group_id', (v_element ->> 'group_id')::uuid,
        'from_user_id', (v_element ->> 'from_user_id')::uuid,
        'to_user_id', (v_element ->> 'to_user_id')::uuid,
        'amount_cents', v_amount_cents
      )
    );
  END LOOP;

  SELECT jsonb_agg(
           jsonb_build_object(
             'group_id', allocation.group_id,
             'from_user_id', allocation.from_user_id,
             'to_user_id', allocation.to_user_id,
             'amount_cents', allocation.amount_cents
           )
           ORDER BY
             allocation.group_id,
             allocation.from_user_id,
             allocation.to_user_id,
             allocation.amount_cents
         )
    INTO v_normalized
    FROM jsonb_to_recordset(v_normalized) AS allocation(
      group_id uuid,
      from_user_id uuid,
      to_user_id uuid,
      amount_cents integer
    );

  IF v_normalized IS DISTINCT FROM v_operation.canonical_request THEN
    RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
  END IF;

  v_item_count := jsonb_array_length(v_normalized);

  IF (
    SELECT count(*)
      FROM public.settlement_operation_items
     WHERE operation_id = p_operation_id
  ) <> v_item_count
    OR EXISTS (
      SELECT 1
        FROM generate_series(0, v_item_count - 1) AS expected(allocation_index)
       WHERE NOT EXISTS (
         SELECT 1
           FROM public.settlement_operation_items AS item
          WHERE item.operation_id = p_operation_id
            AND item.allocation_index = expected.allocation_index
       )
    )
    OR EXISTS (
      SELECT 1
        FROM public.settlement_operation_items AS item
       WHERE item.operation_id = p_operation_id
         AND item.allocation_index >= v_item_count
    ) THEN
    RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
  END IF;

  FOR v_allocation IN
    SELECT
      (element.ordinality - 1)::integer AS allocation_index,
      (element.value ->> 'group_id')::uuid AS group_id,
      (element.value ->> 'from_user_id')::uuid AS from_user_id,
      (element.value ->> 'to_user_id')::uuid AS to_user_id,
      (element.value ->> 'amount_cents')::integer AS amount_cents
    FROM jsonb_array_elements(v_normalized)
      WITH ORDINALITY AS element(value, ordinality)
    ORDER BY element.ordinality
  LOOP
    SELECT
      s.id,
      s.group_id,
      s.from_user_id,
      s.to_user_id,
      s.amount_cents,
      s.status,
      s.created_at,
      s.confirmed_at
      INTO v_settlement
      FROM public.settlement_operation_items AS item
      JOIN public.settlements AS s
        ON s.id = item.settlement_id
     WHERE item.operation_id = p_operation_id
       AND item.allocation_index = v_allocation.allocation_index;

    IF NOT FOUND
      OR v_settlement.group_id IS DISTINCT FROM v_allocation.group_id
      OR v_settlement.from_user_id IS DISTINCT FROM v_allocation.from_user_id
      OR v_settlement.to_user_id IS DISTINCT FROM v_allocation.to_user_id
      OR v_settlement.amount_cents IS DISTINCT FROM v_allocation.amount_cents
      OR v_settlement.status IS DISTINCT FROM 'confirmed'::public.settlement_status
      OR v_settlement.created_at IS NULL
      OR v_settlement.confirmed_at IS NULL THEN
      RAISE EXCEPTION 'settlement_operation_corrupt' USING ERRCODE = 'PST12';
    END IF;

    RETURN QUERY
      SELECT
        v_allocation.allocation_index,
        v_settlement.id,
        v_settlement.group_id,
        v_settlement.from_user_id,
        v_settlement.to_user_id,
        v_settlement.amount_cents,
        v_settlement.status,
        v_settlement.created_at,
        v_settlement.confirmed_at;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_settlement_operation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_settlement_operation(uuid) TO authenticated;

DROP POLICY IF EXISTS settlements_insert ON public.settlements;

REVOKE EXECUTE ON FUNCTION public.record_and_settle(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.record_and_settle(uuid, uuid, uuid, integer);
