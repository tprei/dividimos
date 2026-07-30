-- Issue #495 Slice 1: payer_reachability_repair migration.
--
-- Per #495 spec:
--   'Inventory every expense_payers row without the same (expense_id,
--    user_id) in expense_shares, grouped by draft/active/settled status.'
--
--   Draft: delete only the orphan payer row.
--   Active/settled: insert exactly one zero-cent expense_shares row at
--   the existing user identity/index.
--
-- This migration must run BEFORE the composite FK migration in production.
-- It uses begin_expense_graph_direct_mutation to open tokens for each
-- affected expense, performs the repair, and lets the finalizer validate
-- and bump the revision.
--
-- On a clean database (zero orphan payers), this migration is a no-op.

DO $$
DECLARE
  v_orphan RECORD;
  v_expense_ids uuid[];
  v_token uuid;
  v_repaired_drafts integer := 0;
  v_repaired_active integer := 0;
BEGIN
  -- Inventory all orphan payers
  FOR v_orphan IN
    SELECT ep.expense_id, ep.user_id, e.status
      FROM public.expense_payers ep
      JOIN public.expenses e ON e.id = ep.expense_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.expense_shares es
        WHERE es.expense_id = ep.expense_id
          AND es.user_id = ep.user_id
     )
     ORDER BY ep.expense_id
  LOOP
    IF v_orphan.status = 'draft' THEN
      -- Draft: delete the orphan payer row
      v_expense_ids := ARRAY[v_orphan.expense_id];
      v_token := public.begin_expense_graph_direct_mutation(v_expense_ids);
      DELETE FROM public.expense_payers
       WHERE expense_id = v_orphan.expense_id
         AND user_id = v_orphan.user_id;
      PERFORM graph_internal.close_token(v_token);
      v_repaired_drafts := v_repaired_drafts + 1;

    ELSIF v_orphan.status IN ('active', 'settled') THEN
      -- Active/settled: insert zero-cent share at the existing user identity
      v_expense_ids := ARRAY[v_orphan.expense_id];
      v_token := public.begin_expense_graph_direct_mutation(v_expense_ids);
      INSERT INTO public.expense_shares (expense_id, user_id, share_amount_cents)
      VALUES (v_orphan.expense_id, v_orphan.user_id, 0)
      ON CONFLICT (expense_id, user_id) DO NOTHING;
      PERFORM graph_internal.close_token(v_token);
      v_repaired_active := v_repaired_active + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'payer_reachability_repair: % draft(s), % active/settled',
    v_repaired_drafts, v_repaired_active;
END;
$$;
