-- Issue #599: live-catalog contract for append-only chat_messages.
-- Queries the actual catalog, not migration source text. Split into
-- permanent assertions (retained unchanged when #473 lands) and
-- explicitly phase-local assertions (rewritten by #473).
BEGIN;
SELECT plan(26);

-- ============================================================
-- Permanent assertions
-- ============================================================

-- 1-3: no effective table UPDATE/DELETE for anon/authenticated/service_role
SELECT ok(
  NOT has_table_privilege('anon', 'public.chat_messages', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.chat_messages', 'DELETE'),
  'anon has no table UPDATE/DELETE on chat_messages'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.chat_messages', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.chat_messages', 'DELETE'),
  'authenticated has no table UPDATE/DELETE on chat_messages'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'public.chat_messages', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.chat_messages', 'DELETE'),
  'service_role has no table UPDATE/DELETE on chat_messages despite BYPASSRLS'
);

-- 4-6: no effective any-column UPDATE
SELECT ok(
  NOT has_any_column_privilege('anon', 'public.chat_messages', 'UPDATE'),
  'anon has no column UPDATE privilege on chat_messages'
);
SELECT ok(
  NOT has_any_column_privilege('authenticated', 'public.chat_messages', 'UPDATE'),
  'authenticated has no column UPDATE privilege on chat_messages'
);
SELECT ok(
  NOT has_any_column_privilege('service_role', 'public.chat_messages', 'UPDATE'),
  'service_role has no column UPDATE privilege on chat_messages'
);

-- 7: aclexplode exposes no UPDATE/DELETE grant to PUBLIC or an API role
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM pg_class c, aclexplode(c.relacl) a
      JOIN pg_roles r ON r.oid = a.grantee
     WHERE c.oid = 'public.chat_messages'::regclass
       AND r.rolname IN ('anon', 'authenticated', 'service_role')
       AND a.privilege_type IN ('UPDATE', 'DELETE')
  ),
  'aclexplode shows no direct UPDATE/DELETE grant to any API role'
);

-- 8: no UPDATE, DELETE, or ALL policy exists
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.chat_messages'::regclass
       AND polcmd IN ('w', 'd', '*')
  ),
  'no UPDATE/DELETE/ALL policy exists on chat_messages'
);

-- 9: RLS enabled, FORCE RLS false
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chat_messages'::regclass),
  'RLS is enabled on chat_messages'
);
SELECT ok(
  NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.chat_messages'::regclass),
  'FORCE RLS is not enabled on chat_messages'
);

-- 10: exact trusted non-API owner
SELECT ok(
  (SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.chat_messages'::regclass)
    NOT IN ('anon', 'authenticated', 'service_role'),
  'chat_messages is not owned by an API role'
);

-- 11: retained pair-aware SELECT policy present
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.chat_messages'::regclass
       AND polname = 'chat_messages_select' AND polcmd = 'r'
  ),
  'chat_messages_select policy is present'
);

-- 12: table remains in supabase_realtime
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
  ),
  'chat_messages remains in the supabase_realtime publication'
);

-- 13-15: permanent FK actions
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chat_messages_group_id_fkey' AND conrelid = 'public.chat_messages'::regclass
       AND confrelid = 'public.groups'::regclass AND confdeltype = 'c'
  ),
  'chat_messages_group_id_fkey remains ON DELETE CASCADE'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chat_messages_expense_id_fkey' AND conrelid = 'public.chat_messages'::regclass
       AND confrelid = 'public.expenses'::regclass AND confdeltype = 'n'
  ),
  'chat_messages_expense_id_fkey remains ON DELETE SET NULL'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chat_messages_settlement_id_fkey' AND conrelid = 'public.chat_messages'::regclass
       AND confrelid = 'public.settlements'::regclass AND confdeltype = 'n'
  ),
  'chat_messages_settlement_id_fkey remains ON DELETE SET NULL'
);

-- 16-17: effective trusted chat writers are owner-controlled SECURITY
-- DEFINER with a pinned search_path
SELECT ok(
  (SELECT prosecdef AND proowner::regrole::text NOT IN ('anon', 'authenticated', 'service_role')
     AND proconfig IS NOT NULL AND 'search_path=""' = ANY(proconfig)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_settlements'),
  'record_settlements is owner-controlled SECURITY DEFINER with search_path pinned'
);
SELECT ok(
  (SELECT prosecdef AND proowner::regrole::text NOT IN ('anon', 'authenticated', 'service_role')
     AND proconfig IS NOT NULL AND 'search_path=""' = ANY(proconfig)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'activate_expense'),
  'activate_expense is owner-controlled SECURITY DEFINER with search_path pinned'
);

-- ============================================================
-- Explicitly phase-local assertions (rewritten by #473)
-- ============================================================

-- 18: exactly the final #472 SELECT and temporary INSERT policies exist
SELECT is(
  (SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.chat_messages'::regclass),
  2,
  'exactly two phase-local policies exist (select, insert)'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.chat_messages'::regclass
       AND polname = 'chat_messages_insert' AND polcmd = 'a'
  ),
  'temporary accepted-member direct text INSERT policy remains for this phase'
);

-- 19: pre-#473 sender FK is present with ON DELETE CASCADE
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chat_messages_sender_id_fkey' AND conrelid = 'public.chat_messages'::regclass
       AND confrelid = 'public.users'::regclass AND confdeltype = 'c'
  ),
  'phase-local chat_messages_sender_id_fkey remains ON DELETE CASCADE (removed by #473)'
);

-- 20-21: exact phase-local direct-inserter/orchestrator inventory
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('record_settlements', 'activate_expense', 'activate_saved_expense', 'confirm_chat_expense')),
  4,
  'exactly the four expected writer/orchestrator functions exist'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'record_and_settle'
  ),
  'obsolete record_and_settle signature is absent'
);

-- 22: confirm_chat_expense is SECURITY DEFINER (reaches activate_saved_expense
-- inside its own atomic transaction; does not itself insert chat_messages)
SELECT ok(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_chat_expense'),
  'confirm_chat_expense is SECURITY DEFINER'
);

-- 23: activate_saved_expense is SECURITY DEFINER (delegates to
-- activate_expense for the actual system_expense insert)
SELECT ok(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'activate_saved_expense'),
  'activate_saved_expense is SECURITY DEFINER'
);

-- 24: table structural shape is unchanged (#599 makes no schema change)
SELECT columns_are(
  'public', 'chat_messages',
  ARRAY['id', 'group_id', 'sender_id', 'message_type', 'content', 'expense_id', 'settlement_id', 'created_at'],
  'chat_messages column set is unchanged by #599'
);

SELECT * FROM finish();
ROLLBACK;
