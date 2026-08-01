-- Issue #477 Slice 4: expand the auth.users BEFORE DELETE teardown gate
-- to inventory and lock financial references before the cascade fires.
--
-- Per #477 spec part 1 decision 0:
--   "#477's auth-user teardown trigger inventories and locks every final
--    settlement/balance/operation group reference but never rewrites or
--    deletes #465 history; a restrictive final FK aborts account deletion."
--
-- Per #477 spec part 4 step 5:
--   "the in-place full redefinition of the preparatory auth.users
--    account-teardown root trigger (same identity/order/maintenance-first
--    body)"
--
-- Same trigger name, same firing order (BEFORE DELETE, FOR EACH ROW),
-- same maintenance-gate-first body. The expansion adds group/expense
-- row locks so the CASCADE from public.users → expenses/balances/etc.
-- is atomic under the maintenance gate.

CREATE OR REPLACE FUNCTION financial_internal.auth_users_teardown_maintenance_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_maintenance boolean;
BEGIN
  -- 1. Maintenance gate: hold advisory lock shared for the full transaction.
  --    An already-admitted deletion always finishes its cascade.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(477000001::bigint);

  SELECT maintenance INTO v_maintenance
  FROM financial_internal.financial_compatibility_state
  WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION USING ERRCODE = 'PST09', MESSAGE = 'financial_maintenance';
  END IF;

  -- 2. Inventory and lock every group where the departing user has
  --    financial activity. This prevents concurrent group mutations
  --    from racing with the CASCADE. Under maintenance mode this is
  --    belt-and-suspenders; outside maintenance it coordinates with
  --    any background jobs that might touch these groups.
  PERFORM 1
    FROM public.groups g
   WHERE g.id IN (
     SELECT DISTINCT e.group_id
       FROM public.expenses e
      WHERE e.creator_id = OLD.id
   )
   FOR UPDATE;

  -- 3. Lock expenses owned by the departing user so the CASCADE
  --    (expenses.creator_id → users ON DELETE CASCADE) is atomic.
  PERFORM 1
    FROM public.expenses e
   WHERE e.creator_id = OLD.id
   FOR UPDATE;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION financial_internal.auth_users_teardown_maintenance_gate()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION financial_internal.auth_users_teardown_maintenance_gate() IS
  'Issue #477: maintenance gate + financial-reference inventory/lock for '
  'auth.users deletion. Holds advisory lock 477000001 SHARED, blocks during '
  'financial maintenance, and locks every group/expense row where the '
  'departing user has financial activity before the CASCADE fires. '
  'The caller_id RESTRICT FK on expense_graph_save_operations aborts '
  'deletion when unretired operation ledger rows exist.';
