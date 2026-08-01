-- ============================================================
-- Issue #599: make chat_messages rows append-only across the direct
-- authenticated/service API. Pure ACL/policy removal — no schema
-- change, no new function, no chat-row DML.
--
-- Scope (per the approved spec): remove every direct API capability
-- to UPDATE or DELETE a selected chat_messages row. #472's pair-aware
-- SELECT/temporary accepted-member text INSERT policies are preserved
-- exactly as they already are (my_group_ids()/my_accepted_group_ids()
-- were made pair-aware by #472's migration; this file does not touch
-- either policy). PostgreSQL referential actions (group CASCADE,
-- sender CASCADE until #473, expense/settlement SET NULL) remain real
-- lifecycle transitions, not something this issue denies.
-- ============================================================

DROP POLICY IF EXISTS chat_messages_update ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_delete ON public.chat_messages;

REVOKE UPDATE, DELETE ON TABLE public.chat_messages
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE UPDATE (
  id, group_id, sender_id, message_type,
  content, expense_id, settlement_id, created_at
) ON TABLE public.chat_messages
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- Live-catalog postcondition check. A drift aborts the migration
-- rather than silently landing a partial or unexpected ACL state.
-- ============================================================

DO $$
DECLARE
  v_role text;
  v_has_priv boolean;
  v_policy_count integer;
  v_bad_policy_count integer;
  v_relowner text;
  v_relrowsecurity boolean;
  v_relforcerowsecurity boolean;
  v_fk RECORD;
  v_fk_count integer;
  v_writer_count integer;
  v_bad_writer_count integer;
  v_legacy_count integer;
  v_pub_count integer;
BEGIN
  -- 1. No effective table UPDATE/DELETE and no any-column UPDATE for
  --    anon/authenticated/service_role.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    SELECT has_table_privilege(v_role, 'public.chat_messages', 'UPDATE') INTO v_has_priv;
    IF v_has_priv THEN
      RAISE EXCEPTION 'append_only_postcondition_failed: % retains table UPDATE', v_role;
    END IF;

    SELECT has_table_privilege(v_role, 'public.chat_messages', 'DELETE') INTO v_has_priv;
    IF v_has_priv THEN
      RAISE EXCEPTION 'append_only_postcondition_failed: % retains table DELETE', v_role;
    END IF;

    SELECT has_any_column_privilege(v_role, 'public.chat_messages', 'UPDATE') INTO v_has_priv;
    IF v_has_priv THEN
      RAISE EXCEPTION 'append_only_postcondition_failed: % retains a column UPDATE grant', v_role;
    END IF;
  END LOOP;

  -- 2. No UPDATE/DELETE/ALL policy exists; exactly the two #472 SELECT
  --    and temporary INSERT policies remain for this phase.
  SELECT count(*) INTO v_bad_policy_count
    FROM pg_policy
   WHERE polrelid = 'public.chat_messages'::regclass
     AND polcmd IN ('w', 'd', '*');
  IF v_bad_policy_count > 0 THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: % UPDATE/DELETE/ALL policies remain', v_bad_policy_count;
  END IF;

  SELECT count(*) INTO v_policy_count FROM pg_policy WHERE polrelid = 'public.chat_messages'::regclass;
  IF v_policy_count <> 2 THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: expected exactly 2 phase-local policies (select, insert), found %', v_policy_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.chat_messages'::regclass AND polname = 'chat_messages_select' AND polcmd = 'r'
  ) THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: chat_messages_select policy missing or wrong command';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.chat_messages'::regclass AND polname = 'chat_messages_insert' AND polcmd = 'a'
  ) THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: chat_messages_insert policy missing or wrong command';
  END IF;

  -- 3. RLS enabled, FORCE RLS false, trusted non-API owner.
  SELECT c.relowner::regrole::text, c.relrowsecurity, c.relforcerowsecurity
    INTO v_relowner, v_relrowsecurity, v_relforcerowsecurity
    FROM pg_class c
   WHERE c.oid = 'public.chat_messages'::regclass;

  IF NOT v_relrowsecurity THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: RLS is not enabled on chat_messages';
  END IF;
  IF v_relforcerowsecurity THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: FORCE RLS unexpectedly enabled on chat_messages';
  END IF;
  IF v_relowner IN ('anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: chat_messages is owned by an API role (%)', v_relowner;
  END IF;

  -- 4. The four permanent/phase-local FK actions are exactly as
  --    expected: group CASCADE, sender CASCADE (pre-#473 only),
  --    expense/settlement SET NULL.
  SELECT count(*) INTO v_fk_count
    FROM pg_constraint
   WHERE conrelid = 'public.chat_messages'::regclass AND contype = 'f';
  IF v_fk_count <> 4 THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: expected exactly 4 foreign keys on chat_messages, found %', v_fk_count;
  END IF;

  FOR v_fk IN
    SELECT conname, confrelid::regclass::text AS ref, confdeltype
      FROM pg_constraint
     WHERE conrelid = 'public.chat_messages'::regclass AND contype = 'f'
  LOOP
    IF v_fk.conname = 'chat_messages_group_id_fkey' AND (v_fk.ref <> 'groups' OR v_fk.confdeltype <> 'c') THEN
      RAISE EXCEPTION 'append_only_postcondition_failed: chat_messages_group_id_fkey is not groups/CASCADE';
    ELSIF v_fk.conname = 'chat_messages_sender_id_fkey' AND (v_fk.ref <> 'users' OR v_fk.confdeltype <> 'c') THEN
      RAISE EXCEPTION 'append_only_postcondition_failed: chat_messages_sender_id_fkey is not users/CASCADE';
    ELSIF v_fk.conname = 'chat_messages_expense_id_fkey' AND (v_fk.ref <> 'expenses' OR v_fk.confdeltype <> 'n') THEN
      RAISE EXCEPTION 'append_only_postcondition_failed: chat_messages_expense_id_fkey is not expenses/SET NULL';
    ELSIF v_fk.conname = 'chat_messages_settlement_id_fkey' AND (v_fk.ref <> 'settlements' OR v_fk.confdeltype <> 'n') THEN
      RAISE EXCEPTION 'append_only_postcondition_failed: chat_messages_settlement_id_fkey is not settlements/SET NULL';
    ELSIF v_fk.conname NOT IN (
      'chat_messages_group_id_fkey', 'chat_messages_sender_id_fkey',
      'chat_messages_expense_id_fkey', 'chat_messages_settlement_id_fkey'
    ) THEN
      RAISE EXCEPTION 'append_only_postcondition_failed: unexpected foreign key %', v_fk.conname;
    END IF;
  END LOOP;

  -- 5. Exact phase-local direct-inserter inventory: only
  --    record_settlements(uuid,jsonb) and activate_expense(uuid) (the
  --    body activate_saved_expense delegates to) directly append
  --    chat_messages rows; both are SECURITY DEFINER, owner-controlled,
  --    with SET search_path = ''. Obsolete baseline signatures
  --    (record_and_settle, the old one-arg activate_expense wrapper
  --    name collision guard) are absent.
  SELECT count(*) INTO v_bad_writer_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('record_settlements', 'activate_expense', 'activate_saved_expense', 'confirm_chat_expense')
     AND (
       NOT p.prosecdef
       OR p.proowner::regrole::text IN ('anon', 'authenticated', 'service_role')
       OR NOT (p.proconfig IS NOT NULL AND 'search_path=""' = ANY(p.proconfig))
     );
  IF v_bad_writer_count > 0 THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: % writer function(s) are not owner-controlled SECURITY DEFINER with a pinned search_path', v_bad_writer_count;
  END IF;

  SELECT count(*) INTO v_writer_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('record_settlements', 'activate_expense', 'activate_saved_expense', 'confirm_chat_expense');
  IF v_writer_count <> 4 THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: expected exactly 4 catalogued writer/orchestrator functions, found %', v_writer_count;
  END IF;

  SELECT count(*) INTO v_legacy_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'record_and_settle';
  IF v_legacy_count > 0 THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: obsolete record_and_settle signature still present';
  END IF;

  -- 6. Realtime publication membership is unchanged.
  SELECT count(*) INTO v_pub_count
    FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages';
  IF v_pub_count <> 1 THEN
    RAISE EXCEPTION 'append_only_postcondition_failed: chat_messages is not in supabase_realtime publication';
  END IF;
END;
$$;

COMMENT ON TABLE public.chat_messages IS
  'Issue #599: append-only at the direct API boundary. authenticated/anon/service_role have no table or column UPDATE/DELETE privilege and no UPDATE/DELETE/ALL policy exists. Only PostgreSQL FK referential actions (group CASCADE, sender CASCADE until #473, expense/settlement SET NULL) and trusted owner-only append writers (record_settlements, activate_expense via activate_saved_expense, confirm_chat_expense) may change a row. #473 removes the sender FK and closes the temporary direct-INSERT path with append_chat_message_internal.';
