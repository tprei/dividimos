-- Issue #495 prerequisite: a payer is always a registered-user share row.
-- The constraint is NOT VALID so historical payer-only rows remain readable, but
-- every new write and every graph replacement must satisfy the invariant.
ALTER TABLE public.expense_payers
  ADD CONSTRAINT expense_payers_share_reachability_fk
  FOREIGN KEY (expense_id, user_id)
  REFERENCES public.expense_shares (expense_id, user_id)
  NOT VALID;
ALTER TABLE public.expense_payers
  ALTER CONSTRAINT expense_payers_share_reachability_fk
  DEFERRABLE INITIALLY DEFERRED;

-- The current #468 activation body still owns the legacy one-argument function.
-- This revisioned bridge supplies the successor client contract until the
-- canonical #467 coordinator replaces that body.
CREATE OR REPLACE FUNCTION public.activate_saved_expense(
  p_expense_id uuid,
  p_expected_graph_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_expense public.expenses%ROWTYPE;
  v_revision integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'auth_required';
  END IF;

  SELECT *
    INTO v_expense
    FROM public.expenses
   WHERE id = p_expense_id
   FOR UPDATE;

  IF NOT FOUND OR v_expense.creator_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  IF p_expected_graph_revision IS NULL
     OR p_expected_graph_revision <> v_expense.graph_revision
     OR v_expense.status <> 'draft'
     OR v_expense.graph_revision = 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'stale_graph_revision';
  END IF;

  v_revision := v_expense.graph_revision;
  PERFORM public.activate_expense(p_expense_id);

  UPDATE public.expenses
     SET graph_revision = v_revision + 1
   WHERE id = p_expense_id;

  RETURN pg_catalog.jsonb_build_object(
    'id', p_expense_id,
    'status', 'active',
    'graph_revision', v_revision + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_saved_expense(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_saved_expense(uuid, integer)
  TO authenticated;

COMMENT ON FUNCTION public.activate_saved_expense(uuid, integer) IS
  'Issue #477 prerequisite activation bridge: creator-only revision CAS around the current atomic activation body.';
