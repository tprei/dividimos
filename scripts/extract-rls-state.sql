-- Extract all RLS-relevant metadata from the public schema as a single JSON object.
-- Designed to run against a local Supabase instance after migrations are applied.
-- Output: one JSON row with keys: policies, security_definer_functions,
--         tables_without_rls, tables_rls_no_policies, helper_functions

SELECT jsonb_pretty(jsonb_build_object(
  'policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table', p.tablename,
      'policy_name', p.policyname,
      'command', p.cmd,
      'permissive', p.permissive,
      'roles', p.roles,
      'qual', p.qual,
      'with_check', p.with_check
    ) ORDER BY p.tablename, p.policyname), '[]'::jsonb)
    FROM pg_policies p
    WHERE p.schemaname = 'public'
  ),

  'security_definer_functions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'function_name', p.proname,
      'arguments', pg_get_function_arguments(p.oid),
      'return_type', pg_get_function_result(p.oid),
      'search_path', (
        SELECT string_agg(option_val, ', ')
        FROM pg_options_to_table(p.proconfig)
        WHERE option_name = 'search_path'
      ),
      'definition', pg_get_functiondef(p.oid)
    ) ORDER BY p.proname), '[]'::jsonb)
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  ),

  'tables_without_rls', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  ),

  'tables_rls_enabled_no_policies', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.schemaname = 'public'
      )
  ),

  'helper_functions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'function_name', p.proname,
      'arguments', pg_get_function_arguments(p.oid),
      'return_type', pg_get_function_result(p.oid),
      'definition', pg_get_functiondef(p.oid)
    ) ORDER BY p.proname), '[]'::jsonb)
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND NOT p.prosecdef
      AND p.proname IN ('my_group_ids', 'my_accepted_group_ids')
  )
)) AS rls_state;
