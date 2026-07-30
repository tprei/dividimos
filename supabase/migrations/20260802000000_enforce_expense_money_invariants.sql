-- Issue #477 Slice 7: enforce_expense_money_invariants
-- Forward-migrate expenses.service_fee_percent (numeric) to
-- service_fee_basis_points (integer) with exact data conversion.
-- Per #477: 'Replace percentage floats with integer basis points
-- throughout application/RPC/provider-normalized data.'
--
-- This migration is designed to run under the financial compatibility
-- gate (financial_internal.financial_compatibility_state.maintenance = true)
-- so no concurrent financial traffic touches the table during cutover.

-- ============================================================
-- 1. Column rename + type conversion
-- ============================================================
ALTER TABLE public.expenses
  RENAME COLUMN service_fee_percent TO service_fee_basis_points;

ALTER TABLE public.expenses
  ALTER COLUMN service_fee_basis_points TYPE integer
  USING ((service_fee_basis_points * 100)::integer);

ALTER TABLE public.expenses
  ALTER COLUMN service_fee_basis_points SET DEFAULT 0;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_service_fee_basis_points_check
    CHECK (service_fee_basis_points BETWEEN 0 AND 10000);

-- ============================================================
-- 2. Redefine save_expense_draft_graph to use service_fee_basis_points
--    directly, eliminating the numeric percent conversion variable.
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_expense_draft_graph(
  p_expense                 jsonb,
  p_items                   jsonb,
  p_shares                  jsonb,
  p_payers                  jsonb,
  p_guests                  jsonb,
  p_guest_shares            jsonb,
  p_participant_order       jsonb,
  p_expected_graph_revision integer,
  p_save_operation_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller                    uuid := auth.uid();
  v_group                     public.groups%ROWTYPE;
  v_expense                   public.expenses%ROWTYPE;
  v_operation                 public.expense_graph_save_operations%ROWTYPE;
  v_member_status              text;
  v_requested_group_id        uuid;
  v_candidate_group_id        uuid;
  v_expense_id                uuid;
  v_is_new                    boolean;
  v_canonical_request         jsonb;
  v_result                    jsonb;
  v_next_revision             integer;
  v_title                     text;
  v_merchant_name             text;
  v_expense_type              text;
  v_total_amount               integer;
  v_service_fee_basis_points  integer;
  v_fixed_fees                integer;
  v_numeric                   numeric;
  v_item                      jsonb;
  v_share                     jsonb;
  v_payer                     jsonb;
  v_guest                     jsonb;
  v_guest_share               jsonb;
  v_guest_id                  uuid;
  v_user_id                   uuid;
  v_guest_local_id            text;
  v_quantity                  integer;
  v_unit_price_cents          integer;
  v_total_price_cents         integer;
  v_share_amount_cents        integer;
  v_payer_amount_cents        integer;
  v_expected_line_total       bigint;
  v_user_share_ids            uuid[] := ARRAY[]::uuid[];
  v_payer_user_ids            uuid[] := ARRAY[]::uuid[];
  v_guest_local_ids           text[] := ARRAY[]::text[];
  v_guest_share_local_ids     text[] := ARRAY[]::text[];
  v_user_share_total          bigint := 0;
  v_guest_share_total         bigint := 0;
  v_payer_total                bigint := 0;
  v_protected_claimant_id     uuid;
  v_token                     uuid;
  v_maintenance                boolean;
BEGIN
  -- #477/#495: "Run #477's financial compatibility guard as the first
  -- body action and require authentication."
  SELECT maintenance INTO v_maintenance
    FROM financial_internal.financial_compatibility_state
   WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION USING ERRCODE = 'PST09', MESSAGE = 'financial_maintenance';
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'auth_required';
  END IF;

  IF p_save_operation_id IS NULL
     OR p_expected_graph_revision IS NULL
     OR p_expected_graph_revision < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  IF p_expense IS NULL
     OR pg_catalog.jsonb_typeof(p_expense) <> 'object'
     OR NOT (p_expense ?& ARRAY[
       'group_id',
       'title',
       'merchant_name',
       'expense_type',
       'total_amount',
       'service_fee_basis_points',
       'fixed_fees'
     ])
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_object_keys(p_expense) AS keys(key_name)
        WHERE keys.key_name NOT IN (
          'id',
          'group_id',
          'title',
          'merchant_name',
          'expense_type',
          'total_amount',
          'service_fee_basis_points',
          'fixed_fees'
        )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  IF pg_catalog.jsonb_typeof(p_expense -> 'group_id') <> 'string' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  BEGIN
    v_requested_group_id := (p_expense ->> 'group_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END;

  v_is_new := NOT (p_expense ? 'id');
  IF NOT v_is_new THEN
    IF pg_catalog.jsonb_typeof(p_expense -> 'id') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    BEGIN
      v_expense_id := (p_expense ->> 'id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END;
  END IF;

  v_canonical_request := pg_catalog.jsonb_build_object(
    'expense', p_expense,
    'items', p_items,
    'shares', p_shares,
    'payers', p_payers,
    'guests', p_guests,
    'guest_shares', p_guest_shares,
    'participant_order', p_participant_order,
    'expected_graph_revision', p_expected_graph_revision
  );

  IF v_is_new THEN
    v_candidate_group_id := v_requested_group_id;
  ELSE
    SELECT e.group_id
      INTO v_candidate_group_id
      FROM public.expenses e
     WHERE e.id = v_expense_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;
  END IF;

  SELECT *
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_candidate_group_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'expense_graph_save:' || p_save_operation_id::text,
      477
    )
  );

  SELECT *
    INTO v_operation
    FROM public.expense_graph_save_operations o
   WHERE o.operation_id = p_save_operation_id;

  IF FOUND THEN
    IF v_operation.outcome = 'retired' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST06', MESSAGE = 'operation_retired';
    END IF;

    IF v_operation.outcome <> 'committed'
       OR v_operation.caller_id IS DISTINCT FROM v_caller
       OR v_operation.group_id IS DISTINCT FROM v_group.id
       OR v_operation.canonical_request IS DISTINCT FROM v_canonical_request THEN
      RAISE EXCEPTION USING ERRCODE = 'PST06', MESSAGE = 'operation_conflict';
    END IF;

    IF v_operation.expense_id IS NULL OR v_operation.graph_revision IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'id', v_operation.expense_id,
      'graph_revision', v_operation.graph_revision
    );
  END IF;

  IF v_group.creator_id IS DISTINCT FROM v_caller THEN
    SELECT gm.status::text
      INTO v_member_status
      FROM public.group_members gm
     WHERE gm.group_id = v_group.id
       AND gm.user_id = v_caller
     FOR UPDATE;

    IF NOT FOUND OR v_member_status <> 'accepted' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;
  END IF;

  IF v_is_new THEN
    IF p_expected_graph_revision <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_next_revision := 1;
  ELSE
    SELECT *
      INTO v_expense
      FROM public.expenses e
     WHERE e.id = v_expense_id
     FOR UPDATE;

    IF NOT FOUND OR v_expense.group_id IS DISTINCT FROM v_group.id THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;

    IF v_expense.creator_id IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;

    IF v_requested_group_id IS DISTINCT FROM v_group.id THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    IF v_expense.status <> 'draft'
       OR p_expected_graph_revision <> v_expense.graph_revision
       OR v_expense.graph_revision = 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'stale_graph_revision';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.expense_allocation_entities e
       WHERE e.expense_id = v_expense.id
    ) OR EXISTS (
      SELECT 1
        FROM public.expense_balance_allocation_plans p
       WHERE p.expense_id = v_expense.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.expense_guest_shares gs
        JOIN public.expense_guests g ON g.id = gs.guest_id
       WHERE gs.expense_id = v_expense.id
         AND g.claimed_by IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt';
    END IF;

    -- #495 spec: "run the persisted-draft validator plus payer
    -- reachability before considering the replacement payload. A
    -- current payer without its required user share/map entity is
    -- PST07/orphan_payer_state; any persisted corruption aborts before
    -- incoming graph validation, operation insertion, or DML." The
    -- composite expense_payers_participant_fkey makes this structurally
    -- unreachable for any normally-persisted draft; defense in depth
    -- only, for a corrupt state that could otherwise only arise from a
    -- direct-connection bypass.
    IF EXISTS (
      SELECT 1
        FROM public.expense_payers ep
       WHERE ep.expense_id = v_expense.id
         AND NOT EXISTS (
           SELECT 1 FROM public.expense_shares es
            WHERE es.expense_id = ep.expense_id
              AND es.user_id = ep.user_id
         )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'orphan_payer_state';
    END IF;

    v_next_revision := v_expense.graph_revision + 1;
  END IF;

  IF pg_catalog.jsonb_typeof(p_expense -> 'title') <> 'string'
     OR (pg_catalog.jsonb_typeof(p_expense -> 'merchant_name') <> 'string'
         AND pg_catalog.jsonb_typeof(p_expense -> 'merchant_name') <> 'null')
     OR pg_catalog.jsonb_typeof(p_expense -> 'expense_type') <> 'string'
     OR pg_catalog.jsonb_typeof(p_expense -> 'total_amount') <> 'number'
     OR pg_catalog.jsonb_typeof(p_expense -> 'service_fee_basis_points') <> 'number'
     OR pg_catalog.jsonb_typeof(p_expense -> 'fixed_fees') <> 'number' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  v_title := p_expense ->> 'title';
  v_merchant_name := CASE
    WHEN pg_catalog.jsonb_typeof(p_expense -> 'merchant_name') = 'null' THEN NULL
    ELSE p_expense ->> 'merchant_name'
  END;
  v_expense_type := p_expense ->> 'expense_type';

  IF v_expense_type NOT IN ('itemized', 'single_amount') THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  v_numeric := (p_expense ->> 'total_amount')::numeric;
  IF v_numeric <> pg_catalog.trunc(v_numeric)
     OR v_numeric < 0
     OR v_numeric > public.expense_money_max_cents() THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;
  v_total_amount := v_numeric::integer;

  v_numeric := (p_expense ->> 'service_fee_basis_points')::numeric;
  IF v_numeric <> pg_catalog.trunc(v_numeric)
     OR v_numeric < 0
     OR v_numeric > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;
  v_service_fee_basis_points := v_numeric::integer;

  v_numeric := (p_expense ->> 'fixed_fees')::numeric;
  IF v_numeric <> pg_catalog.trunc(v_numeric)
     OR v_numeric < 0
     OR v_numeric > public.expense_money_max_cents() THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;
  v_fixed_fees := v_numeric::integer;

  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR p_shares IS NULL OR pg_catalog.jsonb_typeof(p_shares) <> 'array'
     OR p_payers IS NULL OR pg_catalog.jsonb_typeof(p_payers) <> 'array'
     OR p_guests IS NULL OR pg_catalog.jsonb_typeof(p_guests) <> 'array'
     OR p_guest_shares IS NULL OR pg_catalog.jsonb_typeof(p_guest_shares) <> 'array'
     OR p_participant_order IS NULL
     OR pg_catalog.jsonb_typeof(p_participant_order) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  IF pg_catalog.jsonb_array_length(p_participant_order) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'participant_order_unsupported';
  END IF;

  IF pg_catalog.jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
       OR NOT (v_item ?& ARRAY[
         'description',
         'quantity',
         'unit_price_cents',
         'total_price_cents'
       ])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_item) AS keys(key_name)
          WHERE keys.key_name NOT IN (
            'description',
            'quantity',
            'unit_price_cents',
            'total_price_cents'
          )
       )
       OR pg_catalog.jsonb_typeof(v_item -> 'description') <> 'string'
       OR pg_catalog.jsonb_typeof(v_item -> 'quantity') <> 'number'
       OR pg_catalog.jsonb_typeof(v_item -> 'unit_price_cents') <> 'number'
       OR pg_catalog.jsonb_typeof(v_item -> 'total_price_cents') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_numeric := (v_item ->> 'quantity')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 1
       OR v_numeric > 999999999 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_quantity := v_numeric::integer;

    v_numeric := (v_item ->> 'unit_price_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 1
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_unit_price_cents := v_numeric::integer;

    v_numeric := (v_item ->> 'total_price_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 1
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_total_price_cents := v_numeric::integer;

    v_expected_line_total := public.compute_expense_line_total_cents(
      v_quantity,
      v_unit_price_cents
    );
    IF v_expected_line_total > public.expense_money_max_cents()
       OR v_total_price_cents <> v_expected_line_total THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
  END LOOP;

  FOR v_share IN SELECT value FROM pg_catalog.jsonb_array_elements(p_shares)
  LOOP
    IF pg_catalog.jsonb_typeof(v_share) <> 'object'
       OR NOT (v_share ?& ARRAY['user_id', 'share_amount_cents'])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_share) AS keys(key_name)
          WHERE keys.key_name NOT IN ('user_id', 'share_amount_cents')
       )
       OR pg_catalog.jsonb_typeof(v_share -> 'user_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_share -> 'share_amount_cents') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    BEGIN
      v_user_id := (v_share ->> 'user_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END;

    IF pg_catalog.array_position(v_user_share_ids, v_user_id) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    IF v_user_id IS DISTINCT FROM v_group.creator_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.group_members gm
          WHERE gm.group_id = v_group.id
            AND gm.user_id = v_user_id
            AND gm.status = 'accepted'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'share_not_group_participant';
    END IF;

    v_numeric := (v_share ->> 'share_amount_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 0
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_share_amount_cents := v_numeric::integer;

    v_user_share_ids := pg_catalog.array_append(v_user_share_ids, v_user_id);
    v_user_share_total := v_user_share_total + v_share_amount_cents;
    IF v_user_share_total > v_total_amount THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
  END LOOP;

  FOR v_guest IN SELECT value FROM pg_catalog.jsonb_array_elements(p_guests)
  LOOP
    IF pg_catalog.jsonb_typeof(v_guest) <> 'object'
       OR NOT (v_guest ?& ARRAY['local_id', 'display_name'])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_guest) AS keys(key_name)
          WHERE keys.key_name NOT IN ('local_id', 'display_name')
       )
       OR pg_catalog.jsonb_typeof(v_guest -> 'local_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_guest -> 'display_name') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_guest_local_id := v_guest ->> 'local_id';
    IF v_guest_local_id = ''
       OR pg_catalog.array_position(v_guest_local_ids, v_guest_local_id) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_guest_local_ids := pg_catalog.array_append(v_guest_local_ids, v_guest_local_id);
  END LOOP;

  FOR v_guest_share IN SELECT value FROM pg_catalog.jsonb_array_elements(p_guest_shares)
  LOOP
    IF pg_catalog.jsonb_typeof(v_guest_share) <> 'object'
       OR NOT (v_guest_share ?& ARRAY['local_id', 'share_amount_cents'])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_guest_share) AS keys(key_name)
          WHERE keys.key_name NOT IN ('local_id', 'share_amount_cents')
       )
       OR pg_catalog.jsonb_typeof(v_guest_share -> 'local_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_guest_share -> 'share_amount_cents') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_guest_local_id := v_guest_share ->> 'local_id';
    IF v_guest_local_id = ''
       OR pg_catalog.array_position(v_guest_share_local_ids, v_guest_local_id) IS NOT NULL
       OR pg_catalog.array_position(v_guest_local_ids, v_guest_local_id) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_numeric := (v_guest_share ->> 'share_amount_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 0
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_share_amount_cents := v_numeric::integer;

    v_guest_share_local_ids := pg_catalog.array_append(
      v_guest_share_local_ids,
      v_guest_local_id
    );
    v_guest_share_total := v_guest_share_total + v_share_amount_cents;
    IF v_guest_share_total > v_total_amount
       OR v_user_share_total + v_guest_share_total > v_total_amount THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
  END LOOP;

  FOR v_payer IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payers)
  LOOP
    IF pg_catalog.jsonb_typeof(v_payer) <> 'object'
       OR NOT (v_payer ?& ARRAY['user_id', 'amount_cents'])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_payer) AS keys(key_name)
          WHERE keys.key_name NOT IN ('user_id', 'amount_cents')
       )
       OR pg_catalog.jsonb_typeof(v_payer -> 'user_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_payer -> 'amount_cents') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    BEGIN
      v_user_id := (v_payer ->> 'user_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END;

    IF pg_catalog.array_position(v_payer_user_ids, v_user_id) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    IF pg_catalog.array_position(v_user_share_ids, v_user_id) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'payer_not_participant';
    END IF;

    v_numeric := (v_payer ->> 'amount_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 1
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_payer_amount_cents := v_numeric::integer;

    v_payer_user_ids := pg_catalog.array_append(v_payer_user_ids, v_user_id);
    v_payer_total := v_payer_total + v_payer_amount_cents;
    IF v_payer_total > v_total_amount THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
  END LOOP;

  IF NOT v_is_new THEN
    FOR v_protected_claimant_id IN
      SELECT DISTINCT g.claimed_by
        FROM public.expense_guests g
       WHERE g.expense_id = v_expense.id
         AND g.claimed_by IS NOT NULL
    LOOP
      IF pg_catalog.array_position(v_user_share_ids, v_protected_claimant_id) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'claimed_guest_not_participant';
      END IF;
    END LOOP;
  END IF;

  IF v_is_new THEN
    v_expense_id := gen_random_uuid();
    v_token := graph_internal.open_named_token(v_expense_id, 'new', 0, v_group.id);

    INSERT INTO public.expenses (
      id,
      group_id,
      creator_id,
      title,
      merchant_name,
      expense_type,
      total_amount,
      service_fee_basis_points,
      fixed_fees,
      status,
      graph_revision
    ) VALUES (
      v_expense_id,
      v_group.id,
      v_caller,
      v_title,
      v_merchant_name,
      v_expense_type::public.expense_type,
      v_total_amount,
      v_service_fee_basis_points,
      v_fixed_fees,
      'draft',
      v_next_revision
    );
  ELSE
    v_token := graph_internal.open_named_token(v_expense.id, 'existing_save', v_expense.graph_revision, v_group.id);

    UPDATE public.expenses
       SET title = v_title,
           merchant_name = v_merchant_name,
           expense_type = v_expense_type::public.expense_type,
           total_amount = v_total_amount,
           service_fee_basis_points = v_service_fee_basis_points,
           fixed_fees = v_fixed_fees,
           graph_revision = v_next_revision
     WHERE id = v_expense.id;

    v_expense_id := v_expense.id;
  END IF;

  DELETE FROM public.expense_guest_shares gs
   WHERE gs.expense_id = v_expense_id
     AND EXISTS (
       SELECT 1
         FROM public.expense_guests g
        WHERE g.id = gs.guest_id
          AND g.claimed_by IS NULL
     );
  DELETE FROM public.expense_payers WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_shares WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_items WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_guests
   WHERE expense_id = v_expense_id
     AND claimed_by IS NULL;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.expense_items (
      expense_id,
      description,
      quantity,
      unit_price_cents,
      total_price_cents
    ) VALUES (
      v_expense_id,
      v_item ->> 'description',
      ((v_item ->> 'quantity')::numeric)::integer,
      ((v_item ->> 'unit_price_cents')::numeric)::integer,
      ((v_item ->> 'total_price_cents')::numeric)::integer
    );
  END LOOP;

  FOR v_share IN SELECT value FROM pg_catalog.jsonb_array_elements(p_shares)
  LOOP
    INSERT INTO public.expense_shares (
      expense_id,
      user_id,
      share_amount_cents
    ) VALUES (
      v_expense_id,
      (v_share ->> 'user_id')::uuid,
      ((v_share ->> 'share_amount_cents')::numeric)::integer
    );
  END LOOP;

  FOR v_guest IN SELECT value FROM pg_catalog.jsonb_array_elements(p_guests)
  LOOP
    INSERT INTO public.expense_guests (expense_id, display_name)
    VALUES (v_expense_id, v_guest ->> 'display_name')
    RETURNING id INTO v_guest_id;

    SELECT gs.value
      INTO v_guest_share
      FROM pg_catalog.jsonb_array_elements(p_guest_shares) AS gs(value)
     WHERE gs.value ->> 'local_id' = v_guest ->> 'local_id';

    IF FOUND THEN
      INSERT INTO public.expense_guest_shares (
        expense_id,
        guest_id,
        share_amount_cents
      ) VALUES (
        v_expense_id,
        v_guest_id,
        ((v_guest_share ->> 'share_amount_cents')::numeric)::integer
      );
    END IF;
  END LOOP;

  FOR v_payer IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payers)
  LOOP
    INSERT INTO public.expense_payers (
      expense_id,
      user_id,
      amount_cents
    ) VALUES (
      v_expense_id,
      (v_payer ->> 'user_id')::uuid,
      ((v_payer ->> 'amount_cents')::numeric)::integer
    );
  END LOOP;

  PERFORM graph_internal.close_token(v_token);

  v_result := pg_catalog.jsonb_build_object(
    'id', v_expense_id,
    'graph_revision', v_next_revision
  );

  INSERT INTO public.expense_graph_save_operations (
    operation_id,
    caller_id,
    group_id,
    canonical_request,
    outcome,
    expense_id,
    graph_revision,
    result,
    result_created_at
  ) VALUES (
    p_save_operation_id,
    v_caller,
    v_group.id,
    v_canonical_request,
    'committed',
    v_expense_id,
    v_next_revision,
    v_result,
    pg_catalog.statement_timestamp()
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 3. Re-apply ACLs on the redefined function
-- ============================================================
REVOKE ALL ON FUNCTION public.save_expense_draft_graph(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.save_expense_draft_graph(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, uuid
) TO authenticated;

-- ============================================================
-- 4. Postflight: assert no live function references the old column
-- ============================================================
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc LIKE '%service_fee_percent%';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Postflight failed: % function(s) still reference service_fee_percent', v_count;
  END IF;
END;
$$;

-- ============================================================
-- 5. Reload PostgREST schema cache (delivered on commit)
-- ============================================================
NOTIFY pgrst, 'reload schema';
