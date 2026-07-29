-- Issue #467: atomic, retry-idempotent chat expense confirmation.
--
-- Current failure: src/lib/supabase/chat-draft-confirm.ts commits
-- save_expense_draft_graph and activate_saved_expense as two separate
-- client-driven RPC calls, then performs a best-effort client-side DELETE
-- of the draft row if activation fails. A lost network response after
-- either call, or a failed compensating DELETE, leaves an orphaned draft or
-- (if the client retries) can create a second expense/balance/message for
-- the same logical confirmation.
--
-- This migration adds one atomic confirm_chat_expense(operation_id,
-- request) RPC that locks the group, checks its own durable operation
-- ledger for exact replay/conflict, then calls the ALREADY-ATOMIC
-- save_expense_draft_graph and activate_saved_expense primitives (see
-- 20260726200000/20260726210000) inside the SAME outer transaction, so
-- draft creation, activation, balance mutation, and the DM system message
-- (already inserted by activate_expense for is_dm groups) commit together
-- or roll back together. It records its own commit in
-- chat_expense_confirmation_operations, giving the chat gesture a stable
-- operation identity independent of expense_graph_save_operations (which is
-- scoped to draft saves specifically and legitimately reuses one expense_id
-- across many operation_id rows over an expense's edit history).
--
-- Scope note vs. the original written issue spec: #472's canonical
-- dm_pairs table does not exist yet, so DM-pair validation here uses the
-- current groups.is_dm + group_members(status='accepted') model (the same
-- model every other current chat/expense RPC uses). The normalized
-- chat_expense_confirmation_users link table and full auth.users hard-delete
-- coordination from the original spec are deferred: this repo has no
-- reachable user hard-delete path today (full account teardown is #477/#481
-- cutover work, still blocked), so the users-table retirement trigger below
-- is scoped to initiated_by_user_id only. Groups, expenses, and chat
-- messages ARE reachable deletion paths and get full retirement coverage.
--
-- Forward-only: new tables/functions only. Does not edit any historical
-- migration (see #478).

-- ============================================================
-- Note: this migration deliberately does NOT revoke authenticated access
-- to the legacy activate_expense(uuid) entry point. It remains directly
-- callable (a real pre-existing gap: activate_saved_expense's revision/CAS
-- guarantee is only enforced by the wrapper, not the underlying primitive)
-- because src/test/integration-helpers.ts's createAndActivateExpense — used
-- pervasively across this repo's integration suite — calls it directly by
-- name. Revoking it is a real hardening opportunity but requires migrating
-- that shared test helper first; out of scope for this migration.
-- ============================================================

-- ============================================================
-- 1. Operation ledger.
-- ============================================================

CREATE TABLE public.chat_expense_confirmation_operations (
  id                    uuid PRIMARY KEY,
  initiated_by_user_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  group_id              uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  outcome               text NOT NULL CHECK (outcome IN ('committed', 'cancelled', 'retired')),
  canonical_request     jsonb,
  expense_id            uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  system_message_id     uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  terminal_code         text,
  created_at            timestamptz NOT NULL DEFAULT statement_timestamp(),
  committed_at          timestamptz,
  cancelled_at          timestamptz,
  retired_at            timestamptz,
  CONSTRAINT chat_expense_confirmation_operations_outcome_shape CHECK (
    (outcome = 'committed'
      AND initiated_by_user_id IS NOT NULL
      AND group_id IS NOT NULL
      AND jsonb_typeof(canonical_request) = 'object'
      AND expense_id IS NOT NULL
      AND system_message_id IS NOT NULL
      AND terminal_code IS NULL
      AND committed_at IS NOT NULL
      AND cancelled_at IS NULL
      AND retired_at IS NULL)
    OR
    (outcome = 'cancelled'
      AND initiated_by_user_id IS NOT NULL
      AND group_id IS NOT NULL
      AND jsonb_typeof(canonical_request) = 'object'
      AND expense_id IS NULL
      AND system_message_id IS NULL
      AND terminal_code IS NOT NULL
      AND committed_at IS NULL
      AND cancelled_at IS NOT NULL
      AND retired_at IS NULL)
    OR
    (outcome = 'retired'
      AND group_id IS NULL
      AND canonical_request IS NULL
      AND expense_id IS NULL
      AND system_message_id IS NULL
      AND terminal_code IS NOT NULL
      AND committed_at IS NULL
      AND cancelled_at IS NULL
      AND retired_at IS NOT NULL)
  ),
  CONSTRAINT chat_expense_confirmation_operations_expense_id_key UNIQUE (expense_id),
  CONSTRAINT chat_expense_confirmation_operations_system_message_id_key UNIQUE (system_message_id)
);

CREATE INDEX ix_chat_expense_confirmation_operations_group
  ON public.chat_expense_confirmation_operations (group_id, id)
  WHERE group_id IS NOT NULL;

CREATE INDEX ix_chat_expense_confirmation_operations_initiator
  ON public.chat_expense_confirmation_operations (initiated_by_user_id, id)
  WHERE initiated_by_user_id IS NOT NULL;

ALTER TABLE public.chat_expense_confirmation_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chat_expense_confirmation_operations
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 2. confirm_chat_expense.
-- ============================================================

CREATE FUNCTION public.confirm_chat_expense(
  p_operation_id uuid,
  p_request      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller               uuid := auth.uid();
  v_group                public.groups%ROWTYPE;
  v_group_found          boolean := false;
  v_group_id             uuid;
  v_canonical_request    jsonb;
  v_operation            public.chat_expense_confirmation_operations%ROWTYPE;
  v_pair_ids             uuid[];
  v_share_user_ids       uuid[] := ARRAY[]::uuid[];
  v_share                jsonb;
  v_payer                jsonb;
  v_item                 jsonb;
  v_share_total          bigint := 0;
  v_payer_total          bigint := 0;
  v_total_amount_cents   integer;
  v_numeric              numeric;
  v_save_result          jsonb;
  v_activation_result    jsonb;
  v_expense_id           uuid;
  v_message_id           uuid;
  v_message_created_at   timestamptz;
  v_expense_created_at   timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'not_authenticated';
  END IF;

  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  -- Structural canonicalization only, no writes yet. Full item/share/payer
  -- semantic validation happens after authority, mirroring
  -- save_expense_draft_graph's own established two-phase pattern.
  IF p_request IS NULL
     OR pg_catalog.jsonb_typeof(p_request) <> 'object'
     OR NOT (p_request ?& ARRAY[
       'schema_version', 'group_id', 'title', 'merchant_name',
       'expense_type', 'total_amount_cents', 'items', 'shares', 'payers'
     ])
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(p_request) AS keys(key_name)
        WHERE keys.key_name NOT IN (
          'schema_version', 'group_id', 'title', 'merchant_name',
          'expense_type', 'total_amount_cents', 'items', 'shares', 'payers'
        )
     )
     OR (p_request ->> 'schema_version') <> '1'
     OR pg_catalog.jsonb_typeof(p_request -> 'group_id') <> 'string'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  BEGIN
    v_group_id := (p_request ->> 'group_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END;

  -- Rebuild the canonical form independently rather than trusting client
  -- key order/whitespace for equality comparisons.
  v_canonical_request := pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'group_id', v_group_id::text,
    'title', p_request ->> 'title',
    'merchant_name', p_request -> 'merchant_name',
    'expense_type', p_request ->> 'expense_type',
    'total_amount_cents', p_request -> 'total_amount_cents',
    'items', p_request -> 'items',
    'shares', p_request -> 'shares',
    'payers', p_request -> 'payers'
  );

  -- Group lock precedes the operation lock (matches #466 convention and
  -- save_expense_draft_graph's own ordering).
  SELECT * INTO v_group FROM public.groups g WHERE g.id = v_group_id FOR UPDATE;
  v_group_found := FOUND;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chat_expense_confirm:' || p_operation_id::text, 467)
  );

  SELECT * INTO v_operation
    FROM public.chat_expense_confirmation_operations o
   WHERE o.id = p_operation_id;

  IF FOUND THEN
    IF v_operation.outcome = 'retired' THEN
      RETURN pg_catalog.jsonb_build_object(
        'operation_id', p_operation_id,
        'outcome', 'retired',
        'created', false,
        'operation_created_at', v_operation.created_at,
        'terminal_code', v_operation.terminal_code,
        'expense', NULL,
        'system_message_id', NULL
      );
    END IF;

    IF v_operation.initiated_by_user_id IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;

    IF v_operation.canonical_request IS DISTINCT FROM v_canonical_request THEN
      RAISE EXCEPTION USING ERRCODE = 'PST06', MESSAGE = 'operation_conflict';
    END IF;

    IF v_operation.outcome = 'cancelled' THEN
      RETURN pg_catalog.jsonb_build_object(
        'operation_id', p_operation_id,
        'outcome', 'cancelled',
        'created', false,
        'operation_created_at', v_operation.created_at,
        'terminal_code', v_operation.terminal_code,
        'expense', NULL,
        'system_message_id', NULL
      );
    END IF;

    -- committed + matches: exact replay. Non-locking read of the stored
    -- expense state; never rerun membership/financial/message/push effects.
    IF v_operation.expense_id IS NULL OR v_operation.system_message_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'operation_state_corrupt';
    END IF;

    SELECT e.created_at INTO v_expense_created_at
      FROM public.expenses e
     WHERE e.id = v_operation.expense_id
       AND e.status IN ('active', 'settled');

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'operation_state_corrupt';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id,
      'outcome', 'committed',
      'created', false,
      'operation_created_at', v_operation.created_at,
      'terminal_code', NULL,
      'expense', pg_catalog.jsonb_build_object(
        'id', v_operation.expense_id,
        'status', 'active',
        'created_at', v_expense_created_at
      ),
      'system_message_id', v_operation.system_message_id
    );
  END IF;

  -- No operation row. A missing group with no operation is a lifecycle
  -- conflict, never disclosed as a distinguishable "not found".
  IF NOT v_group_found THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'lifecycle_conflict';
  END IF;

  -- DM shape: exactly this group's is_dm flag plus its current eligible
  -- pair (creator or accepted member). No dm_pairs table exists yet (#472
  -- is not landed); this mirrors the same model activate_expense/
  -- save_expense_draft_graph already use for group authority.
  IF NOT v_group.is_dm THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  SELECT pg_catalog.array_agg(uid ORDER BY uid) INTO v_pair_ids
    FROM (
      SELECT v_group.creator_id AS uid
      UNION
      SELECT gm.user_id
        FROM public.group_members gm
       WHERE gm.group_id = v_group.id
         AND gm.status = 'accepted'
    ) pair;

  IF v_pair_ids IS NULL
     OR pg_catalog.array_length(v_pair_ids, 1) <> 2
     OR NOT (v_caller = ANY (v_pair_ids))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  -- Deep validation, only after authority.
  IF pg_catalog.jsonb_typeof(p_request -> 'title') <> 'string'
     OR btrim(p_request ->> 'title') = ''
     OR (pg_catalog.jsonb_typeof(p_request -> 'merchant_name') <> 'string'
         AND pg_catalog.jsonb_typeof(p_request -> 'merchant_name') <> 'null')
     OR (p_request ->> 'expense_type') NOT IN ('itemized', 'single_amount')
     OR pg_catalog.jsonb_typeof(p_request -> 'items') <> 'array'
     OR pg_catalog.jsonb_typeof(p_request -> 'shares') <> 'array'
     OR pg_catalog.jsonb_typeof(p_request -> 'payers') <> 'array'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  v_numeric := (p_request -> 'total_amount_cents')::numeric;
  IF v_numeric IS NULL
     OR v_numeric <> pg_catalog.trunc(v_numeric)
     OR v_numeric < 1
     OR v_numeric > public.expense_money_max_cents()
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;
  v_total_amount_cents := v_numeric::integer;

  IF pg_catalog.jsonb_array_length(p_request -> 'items') > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  IF pg_catalog.jsonb_array_length(p_request -> 'shares') < 1
     OR pg_catalog.jsonb_array_length(p_request -> 'shares') > 2
     OR pg_catalog.jsonb_array_length(p_request -> 'payers') < 1
     OR pg_catalog.jsonb_array_length(p_request -> 'payers') > 2
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  FOR v_share IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request -> 'shares')
  LOOP
    IF pg_catalog.jsonb_typeof(v_share) <> 'object'
       OR NOT (v_share ?& ARRAY['user_id', 'share_amount_cents'])
       OR pg_catalog.jsonb_typeof(v_share -> 'user_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_share -> 'share_amount_cents') <> 'number'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    IF NOT ((v_share ->> 'user_id')::uuid = ANY (v_pair_ids)) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'invalid_users';
    END IF;

    IF (v_share ->> 'user_id')::uuid = ANY (v_share_user_ids) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;
    v_share_user_ids := pg_catalog.array_append(v_share_user_ids, (v_share ->> 'user_id')::uuid);

    v_numeric := (v_share -> 'share_amount_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric) OR v_numeric < 0 OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_share_total := v_share_total + v_numeric::bigint;
  END LOOP;

  IF v_share_total <> v_total_amount_cents THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;

  FOR v_payer IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request -> 'payers')
  LOOP
    IF pg_catalog.jsonb_typeof(v_payer) <> 'object'
       OR NOT (v_payer ?& ARRAY['user_id', 'amount_cents'])
       OR pg_catalog.jsonb_typeof(v_payer -> 'user_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_payer -> 'amount_cents') <> 'number'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    IF NOT ((v_payer ->> 'user_id')::uuid = ANY (v_pair_ids)) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'invalid_users';
    END IF;

    IF NOT ((v_payer ->> 'user_id')::uuid = ANY (v_share_user_ids)) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'invalid_users';
    END IF;

    v_numeric := (v_payer -> 'amount_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric) OR v_numeric < 1 OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_payer_total := v_payer_total + v_numeric::bigint;
  END LOOP;

  IF v_payer_total <> v_total_amount_cents THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;

  IF (p_request ->> 'expense_type') = 'single_amount'
     AND pg_catalog.jsonb_array_length(p_request -> 'items') <> 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request -> 'items')
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
       OR NOT (v_item ?& ARRAY['description', 'quantity', 'unit_price_cents', 'total_price_cents'])
       OR pg_catalog.jsonb_typeof(v_item -> 'description') <> 'string'
       OR btrim(v_item ->> 'description') = ''
       OR pg_catalog.jsonb_typeof(v_item -> 'quantity') <> 'number'
       OR pg_catalog.jsonb_typeof(v_item -> 'unit_price_cents') <> 'number'
       OR pg_catalog.jsonb_typeof(v_item -> 'total_price_cents') <> 'number'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;
  END LOOP;

  -- Hand off to the two already-atomic primitives, in the same outer
  -- transaction. Chat confirmation always creates a brand-new expense.
  v_save_result := public.save_expense_draft_graph(
    pg_catalog.jsonb_build_object(
      'group_id', v_group_id::text,
      'title', btrim(p_request ->> 'title'),
      'merchant_name', p_request -> 'merchant_name',
      'expense_type', p_request ->> 'expense_type',
      'total_amount', v_total_amount_cents,
      'service_fee_basis_points', 0,
      'fixed_fees', 0
    ),
    p_request -> 'items',
    p_request -> 'shares',
    p_request -> 'payers',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    0,
    p_operation_id
  );

  v_expense_id := (v_save_result ->> 'id')::uuid;

  v_activation_result := public.activate_saved_expense(
    v_expense_id,
    (v_save_result ->> 'graph_revision')::integer
  );

  SELECT cm.id, cm.created_at INTO v_message_id, v_message_created_at
    FROM public.chat_messages cm
   WHERE cm.expense_id = v_expense_id
     AND cm.message_type = 'system_expense'
   ORDER BY cm.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'operation_state_corrupt';
  END IF;

  SELECT e.created_at INTO v_expense_created_at
    FROM public.expenses e
   WHERE e.id = v_expense_id;

  INSERT INTO public.chat_expense_confirmation_operations (
    id, initiated_by_user_id, group_id, outcome, canonical_request,
    expense_id, system_message_id, committed_at
  ) VALUES (
    p_operation_id, v_caller, v_group.id, 'committed', v_canonical_request,
    v_expense_id, v_message_id, statement_timestamp()
  );

  RETURN pg_catalog.jsonb_build_object(
    'operation_id', p_operation_id,
    'outcome', 'committed',
    'created', true,
    'operation_created_at', statement_timestamp(),
    'terminal_code', NULL,
    'expense', pg_catalog.jsonb_build_object(
      'id', v_expense_id,
      'status', 'active',
      'created_at', v_expense_created_at
    ),
    'system_message_id', v_message_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_chat_expense(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_chat_expense(uuid, jsonb) TO authenticated;

-- ============================================================
-- 3. get_chat_expense_confirmation. Exact-owner recovery read. Does not
--    check current group membership — recovery must survive membership
--    loss after a genuine commit.
-- ============================================================

CREATE FUNCTION public.get_chat_expense_confirmation(
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_operation public.chat_expense_confirmation_operations%ROWTYPE;
  v_expense_created_at timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'not_authenticated';
  END IF;

  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chat_expense_confirm:' || p_operation_id::text, 467)
  );

  SELECT * INTO v_operation
    FROM public.chat_expense_confirmation_operations o
   WHERE o.id = p_operation_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id,
      'outcome', 'not_found',
      'created', false,
      'operation_created_at', NULL,
      'terminal_code', NULL,
      'expense', NULL,
      'system_message_id', NULL
    );
  END IF;

  IF v_operation.outcome = 'retired' THEN
    RETURN pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id,
      'outcome', 'retired',
      'created', false,
      'operation_created_at', v_operation.created_at,
      'terminal_code', v_operation.terminal_code,
      'expense', NULL,
      'system_message_id', NULL
    );
  END IF;

  -- Another live owner is indistinguishable from not_found.
  IF v_operation.initiated_by_user_id IS DISTINCT FROM v_caller THEN
    RETURN pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id,
      'outcome', 'not_found',
      'created', false,
      'operation_created_at', NULL,
      'terminal_code', NULL,
      'expense', NULL,
      'system_message_id', NULL
    );
  END IF;

  IF v_operation.outcome = 'cancelled' THEN
    RETURN pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id,
      'outcome', 'cancelled',
      'created', false,
      'operation_created_at', v_operation.created_at,
      'terminal_code', v_operation.terminal_code,
      'expense', NULL,
      'system_message_id', NULL
    );
  END IF;

  SELECT e.created_at INTO v_expense_created_at
    FROM public.expenses e
   WHERE e.id = v_operation.expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'operation_state_corrupt';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'operation_id', p_operation_id,
    'outcome', 'committed',
    'created', false,
    'operation_created_at', v_operation.created_at,
    'terminal_code', NULL,
    'expense', pg_catalog.jsonb_build_object(
      'id', v_operation.expense_id,
      'status', 'active',
      'created_at', v_expense_created_at
    ),
    'system_message_id', v_operation.system_message_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_expense_confirmation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_expense_confirmation(uuid) TO authenticated;

-- ============================================================
-- 4. cancel_chat_expense_confirmation.
-- ============================================================

CREATE FUNCTION public.cancel_chat_expense_confirmation(
  p_operation_id  uuid,
  p_request       jsonb,
  p_terminal_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller            uuid := auth.uid();
  v_canonical_request jsonb;
  v_group_id          uuid;
  v_group_found       boolean := false;
  v_operation         public.chat_expense_confirmation_operations%ROWTYPE;
  v_malformed         boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'not_authenticated';
  END IF;

  IF p_operation_id IS NULL
     OR p_terminal_code IS NULL
     OR p_terminal_code NOT IN ('client_cancelled', 'PST02', 'PST03', 'PST04', 'PST05', 'PST08')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  -- Attempt the same structural canonicalization confirm_chat_expense uses.
  IF p_request IS NULL
     OR pg_catalog.jsonb_typeof(p_request) <> 'object'
     OR NOT (p_request ?& ARRAY[
       'schema_version', 'group_id', 'title', 'merchant_name',
       'expense_type', 'total_amount_cents', 'items', 'shares', 'payers'
     ])
     OR (p_request ->> 'schema_version') <> '1'
     OR pg_catalog.jsonb_typeof(p_request -> 'group_id') <> 'string'
  THEN
    v_malformed := true;
  ELSE
    BEGIN
      v_group_id := (p_request ->> 'group_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        v_malformed := true;
    END;
  END IF;

  IF v_malformed AND p_terminal_code = 'PST02' THEN
    -- Cannot compare a request that has no canonical form. Retire the UUID
    -- without a group lock, inspecting only by id.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('chat_expense_confirm:' || p_operation_id::text, 467)
    );

    SELECT * INTO v_operation
      FROM public.chat_expense_confirmation_operations o
     WHERE o.id = p_operation_id;

    IF FOUND THEN
      IF v_operation.outcome = 'retired' THEN
        RETURN pg_catalog.jsonb_build_object(
          'operation_id', p_operation_id, 'outcome', 'retired', 'created', false,
          'operation_created_at', v_operation.created_at, 'terminal_code', v_operation.terminal_code,
          'expense', NULL, 'system_message_id', NULL
        );
      END IF;
      IF v_operation.initiated_by_user_id IS DISTINCT FROM v_caller THEN
        RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
      END IF;
      -- Already-terminal same-owner outcome: return it unchanged (never
      -- reverses a commit).
      IF v_operation.outcome = 'committed' THEN
        RETURN pg_catalog.jsonb_build_object(
          'operation_id', p_operation_id, 'outcome', 'committed', 'created', false,
          'operation_created_at', v_operation.created_at, 'terminal_code', NULL,
          'expense', pg_catalog.jsonb_build_object('id', v_operation.expense_id, 'status', 'active'),
          'system_message_id', v_operation.system_message_id
        );
      END IF;
      RETURN pg_catalog.jsonb_build_object(
        'operation_id', p_operation_id, 'outcome', 'cancelled', 'created', false,
        'operation_created_at', v_operation.created_at, 'terminal_code', v_operation.terminal_code,
        'expense', NULL, 'system_message_id', NULL
      );
    END IF;

    INSERT INTO public.chat_expense_confirmation_operations (
      id, outcome, terminal_code, retired_at
    ) VALUES (
      p_operation_id, 'retired', 'PST02', statement_timestamp()
    );

    RETURN pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id, 'outcome', 'retired', 'created', false,
      'operation_created_at', statement_timestamp(), 'terminal_code', 'PST02',
      'expense', NULL, 'system_message_id', NULL
    );
  ELSIF v_malformed THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  v_canonical_request := pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'group_id', v_group_id::text,
    'title', p_request ->> 'title',
    'merchant_name', p_request -> 'merchant_name',
    'expense_type', p_request ->> 'expense_type',
    'total_amount_cents', p_request -> 'total_amount_cents',
    'items', p_request -> 'items',
    'shares', p_request -> 'shares',
    'payers', p_request -> 'payers'
  );

  PERFORM 1 FROM public.groups g WHERE g.id = v_group_id FOR UPDATE;
  v_group_found := FOUND;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chat_expense_confirm:' || p_operation_id::text, 467)
  );

  SELECT * INTO v_operation
    FROM public.chat_expense_confirmation_operations o
   WHERE o.id = p_operation_id;

  IF FOUND THEN
    IF v_operation.outcome = 'retired' THEN
      RETURN pg_catalog.jsonb_build_object(
        'operation_id', p_operation_id, 'outcome', 'retired', 'created', false,
        'operation_created_at', v_operation.created_at, 'terminal_code', v_operation.terminal_code,
        'expense', NULL, 'system_message_id', NULL
      );
    END IF;

    IF v_operation.initiated_by_user_id IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;

    IF v_operation.canonical_request IS DISTINCT FROM v_canonical_request THEN
      RAISE EXCEPTION USING ERRCODE = 'PST06', MESSAGE = 'operation_conflict';
    END IF;

    -- Cancellation never reverses a commit.
    IF v_operation.outcome = 'committed' THEN
      RETURN pg_catalog.jsonb_build_object(
        'operation_id', p_operation_id, 'outcome', 'committed', 'created', false,
        'operation_created_at', v_operation.created_at, 'terminal_code', NULL,
        'expense', pg_catalog.jsonb_build_object('id', v_operation.expense_id, 'status', 'active'),
        'system_message_id', v_operation.system_message_id
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id, 'outcome', 'cancelled', 'created', false,
      'operation_created_at', v_operation.created_at, 'terminal_code', v_operation.terminal_code,
      'expense', NULL, 'system_message_id', NULL
    );
  END IF;

  IF v_group_found THEN
    INSERT INTO public.chat_expense_confirmation_operations (
      id, initiated_by_user_id, group_id, outcome, canonical_request,
      terminal_code, cancelled_at
    ) VALUES (
      p_operation_id, v_caller, v_group_id, 'cancelled', v_canonical_request,
      p_terminal_code, statement_timestamp()
    );

    RETURN pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id, 'outcome', 'cancelled', 'created', false,
      'operation_created_at', statement_timestamp(), 'terminal_code', p_terminal_code,
      'expense', NULL, 'system_message_id', NULL
    );
  END IF;

  -- Group already gone: retire directly rather than record a cancelled
  -- operation against a nonexistent group.
  INSERT INTO public.chat_expense_confirmation_operations (
    id, outcome, terminal_code, retired_at
  ) VALUES (
    p_operation_id, 'retired', 'group_deleted', statement_timestamp()
  );

  RETURN pg_catalog.jsonb_build_object(
    'operation_id', p_operation_id, 'outcome', 'retired', 'created', false,
    'operation_created_at', statement_timestamp(), 'terminal_code', 'group_deleted',
    'expense', NULL, 'system_message_id', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_chat_expense_confirmation(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_chat_expense_confirmation(uuid, jsonb, text) TO authenticated;

-- ============================================================
-- 5. Retirement triggers. Scrub affected operation rows to 'retired'
--    BEFORE the referenced parent row is deleted, so no live ledger row
--    ever survives referencing a gone group/expense/message. See the
--    scope note at the top of this file re: the users trigger.
-- ============================================================

CREATE FUNCTION public.retire_chat_expense_confirmations_for_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.chat_expense_confirmation_operations
     SET outcome = 'retired',
         group_id = NULL,
         canonical_request = NULL,
         expense_id = NULL,
         system_message_id = NULL,
         terminal_code = 'group_deleted',
         committed_at = NULL,
         cancelled_at = NULL,
         retired_at = statement_timestamp()
   WHERE group_id = OLD.id
     AND outcome IN ('committed', 'cancelled');
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_retire_chat_expense_confirmations_for_group
  BEFORE DELETE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.retire_chat_expense_confirmations_for_group();

CREATE FUNCTION public.retire_chat_expense_confirmations_for_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.chat_expense_confirmation_operations
     SET outcome = 'retired',
         group_id = NULL,
         canonical_request = NULL,
         expense_id = NULL,
         system_message_id = NULL,
         terminal_code = 'expense_deleted',
         committed_at = NULL,
         cancelled_at = NULL,
         retired_at = statement_timestamp()
   WHERE expense_id = OLD.id
     AND outcome IN ('committed', 'cancelled');
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_retire_chat_expense_confirmations_for_expense
  BEFORE DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.retire_chat_expense_confirmations_for_expense();

CREATE FUNCTION public.retire_chat_expense_confirmations_for_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.chat_expense_confirmation_operations
     SET outcome = 'retired',
         group_id = NULL,
         canonical_request = NULL,
         expense_id = NULL,
         system_message_id = NULL,
         terminal_code = 'expense_deleted',
         committed_at = NULL,
         cancelled_at = NULL,
         retired_at = statement_timestamp()
   WHERE system_message_id = OLD.id
     AND outcome IN ('committed', 'cancelled');
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_retire_chat_expense_confirmations_for_message
  BEFORE DELETE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.retire_chat_expense_confirmations_for_message();

-- Scoped to initiated_by_user_id only (see file header scope note): this
-- repo has no reachable full user hard-delete path today, so a live ledger
-- row can currently only ever reference a deleted user via this column.
CREATE FUNCTION public.retire_chat_expense_confirmations_for_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.chat_expense_confirmation_operations
     SET outcome = 'retired',
         initiated_by_user_id = NULL,
         group_id = NULL,
         canonical_request = NULL,
         expense_id = NULL,
         system_message_id = NULL,
         terminal_code = 'user_deleted',
         committed_at = NULL,
         cancelled_at = NULL,
         retired_at = statement_timestamp()
   WHERE initiated_by_user_id = OLD.id
     AND outcome IN ('committed', 'cancelled');
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_retire_chat_expense_confirmations_for_user
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.retire_chat_expense_confirmations_for_user();
