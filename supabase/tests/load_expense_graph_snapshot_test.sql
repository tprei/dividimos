-- Issue #477: catalog contract for load_expense_graph_snapshot, the fourth
-- of the four "final signatures" the spec names explicitly. Queries the
-- actual catalog, not migration source text.
BEGIN;
SELECT plan(9);

-- 1: function exists with the exact signature
SELECT has_function(
  'public', 'load_expense_graph_snapshot', ARRAY['uuid'],
  'load_expense_graph_snapshot(uuid) exists'
);

-- 2: returns jsonb
SELECT function_returns(
  'public', 'load_expense_graph_snapshot', ARRAY['uuid'], 'jsonb',
  'load_expense_graph_snapshot returns jsonb'
);

-- 3: owner-controlled SECURITY DEFINER with search_path pinned (matches
-- the same trusted-writer contract every other expense-graph RPC uses)
SELECT ok(
  (SELECT prosecdef AND proowner::regrole::text NOT IN ('anon', 'authenticated', 'service_role')
     AND proconfig IS NOT NULL AND 'search_path=""' = ANY(proconfig)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'load_expense_graph_snapshot'),
  'load_expense_graph_snapshot is owner-controlled SECURITY DEFINER with search_path pinned'
);

-- 4-5: authenticated-only EXECUTE grant (non-leaking: not exposed to anon or
-- service_role beyond its own BYPASSRLS superuser-equivalent access)
SELECT ok(
  has_function_privilege('authenticated', 'public.load_expense_graph_snapshot(uuid)', 'EXECUTE'),
  'authenticated has EXECUTE on load_expense_graph_snapshot'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.load_expense_graph_snapshot(uuid)', 'EXECUTE'),
  'anon has no EXECUTE on load_expense_graph_snapshot'
);

-- 6: PUBLIC has no default EXECUTE either (aclexplode over the raw ACL,
-- not has_function_privilege, so a PUBLIC-only grant is caught even if
-- no single named role's privilege check would surface it)
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.load_expense_graph_snapshot(uuid)'::regprocedure
       AND a.grantee = 0
       AND a.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE grant in the raw ACL'
);

-- 7: my_accepted_group_ids and assert_dm_group_shape (the reused #471/#472
-- authority helpers this loader depends on) still exist with their expected
-- signatures - defense against a silent rename/removal elsewhere breaking
-- this loader without its own tests catching it
SELECT has_function(
  'public', 'my_accepted_group_ids', ARRAY[]::text[],
  'my_accepted_group_ids() still exists'
);
SELECT has_function(
  'public', 'assert_dm_group_shape', ARRAY['uuid', 'boolean'],
  'assert_dm_group_shape(uuid, boolean) still exists'
);

-- 8: the four "final signatures" #477 names are all present together
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'save_expense_draft_graph', 'resolve_expense_graph_save_result',
        'activate_saved_expense', 'load_expense_graph_snapshot'
      )),
  4,
  'all four #477 final signatures exist together'
);

SELECT * FROM finish();
ROLLBACK;
