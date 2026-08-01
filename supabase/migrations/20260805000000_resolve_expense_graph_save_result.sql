-- Issue #477 Slice 5: resolve_expense_graph_save_result RPC
--
-- Per #477 spec:
--   'resolve_expense_graph_save_result(p_save_operation_id uuid,
--    p_group_id uuid) RETURNS jsonb'
--
-- Returns { outcome: "retired" } or { outcome: "committed", id, graph_revision }
-- or NULL for an operation that hasn't reached the server.
--
-- This enables durable save-operation reconciliation: if the client crashes
-- or loses the save response, it can check whether the operation committed
-- on remount, recovering the expense ID without a duplicate save.

CREATE OR REPLACE FUNCTION public.resolve_expense_graph_save_result(
  p_save_operation_id uuid,
  p_group_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_op     public.expense_graph_save_operations%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'auth_required';
  END IF;

  IF p_save_operation_id IS NULL OR p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  SELECT * INTO v_op
    FROM public.expense_graph_save_operations
   WHERE operation_id = p_save_operation_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_op.caller_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  IF v_op.group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  IF v_op.outcome = 'retired' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'retired');
  END IF;

  IF v_op.outcome = 'committed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'committed',
      'id', v_op.expense_id,
      'graph_revision', v_op.graph_revision
    );
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.resolve_expense_graph_save_result(uuid, uuid) IS
  'Issue #477: Resolve a save-operation ledger entry for durable client '
  'reconciliation. Returns committed/retired or NULL (not yet reached server). '
  'Only the original caller for the matching group can resolve their own '
  'operation.';

REVOKE ALL ON FUNCTION public.resolve_expense_graph_save_result(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_expense_graph_save_result(uuid, uuid)
  TO authenticated;
