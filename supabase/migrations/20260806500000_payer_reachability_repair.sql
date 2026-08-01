-- Issue #495 Slice 1: payer_reachability_repair migration.
--
-- Per #495 spec:
--   'Inventory every expense_payers row without the same (expense_id,
--    user_id) in expense_shares, grouped by draft/active/settled status.'
--
--   Draft: delete only the orphan payer row.
--   Active/settled: 'require the existing payer-only user allocation
--   entity established by #468's historical map. Insert exactly one
--   zero-cent expense_shares row at that existing user identity/index.'
--   'Abort on a missing/duplicate map entity, unexplained claim state,
--    invalid financial reference, or any anomaly outside the
--    deterministic repairs below.'
--
-- This migration must run BEFORE the composite FK migration in production.
-- It uses begin_expense_graph_direct_mutation to open a token per orphan
-- and performs the repair. Only one 'direct' token may be open at a time
-- (per #477), so each iteration must settle its own token before the
-- next opens one -- but a 'direct' token's caller is forbidden from
-- bumping graph_revision inline (only the deferred finalizer's
-- 'direct'-source auto-bump may), and that finalizer requires its token
-- to still be *open* when it fires. `SET CONSTRAINTS ALL IMMEDIATE`
-- therefore replaces `close_token`: it forces the finalizer to run now,
-- while the token remains open, and the finalizer marks its own token
-- 'closed' once it succeeds. Because `SET CONSTRAINTS` changes checking
-- timing for the rest of the transaction (not a one-time flush), it is
-- immediately followed by `SET CONSTRAINTS ALL DEFERRED` -- otherwise a
-- second loop iteration's token would fire its own finalizer the instant
-- it is inserted, before its target row is even registered, and get
-- treated as a zero-event no-op before ever reaching its DML.
--
-- On a clean database (zero orphan payers), this migration is a no-op.
-- See src/lib/supabase/payer-reachability-repair.integration.test.ts for
-- coverage: it replays this exact statement against seeded pre-repair
-- corruption on a disposable schema (spec item 13), proving both the
-- draft-delete and active/settled-zero-share-insert branches, and proving
-- the anomaly branch aborts the migration rather than fabricating a share.

DO $$
DECLARE
  v_orphan RECORD;
  v_expense_ids uuid[];
  v_token uuid;
  v_repaired_drafts integer := 0;
  v_repaired_active integer := 0;
  v_entity_index integer;
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
      -- Draft: delete the orphan payer row. A draft never has allocation
      -- entities (save_expense_draft_graph/validate_graph_mode both
      -- reject a draft with any expense_allocation_entities row), so
      -- there is no backing-entity precondition to check here.
      v_expense_ids := ARRAY[v_orphan.expense_id];
      v_token := public.begin_expense_graph_direct_mutation(v_expense_ids);
      DELETE FROM public.expense_payers
       WHERE expense_id = v_orphan.expense_id
         AND user_id = v_orphan.user_id;
      SET CONSTRAINTS ALL IMMEDIATE;
      SET CONSTRAINTS ALL DEFERRED;
      v_repaired_drafts := v_repaired_drafts + 1;

    ELSIF v_orphan.status IN ('active', 'settled') THEN
      -- Active/settled: the orphan payer must already have a payer-only
      -- user allocation entity from #468's historical activation map --
      -- that is the "existing user identity/index" the spec requires the
      -- zero share to land on. An orphan payer with no such entity is not
      -- one of the deterministic repairs; it is a genuine anomaly (e.g. a
      -- payer inserted by some other bypass with no activation-time
      -- provenance at all), and per spec step 2 the whole migration must
      -- abort rather than fabricate identity #468 never established.
      SELECT participant_index
        INTO v_entity_index
        FROM public.expense_allocation_entities
       WHERE expense_id = v_orphan.expense_id
         AND entity_kind = 'user'
         AND user_id = v_orphan.user_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = 'PST07',
          MESSAGE = format(
            'payer_reachability_repair: anomaly -- %s orphan payer %s on expense %s has no backing user allocation entity; aborting',
            v_orphan.status, v_orphan.user_id, v_orphan.expense_id
          );
      END IF;

      v_expense_ids := ARRAY[v_orphan.expense_id];
      v_token := public.begin_expense_graph_direct_mutation(v_expense_ids);
      INSERT INTO public.expense_shares (expense_id, user_id, share_amount_cents)
      VALUES (v_orphan.expense_id, v_orphan.user_id, 0)
      ON CONFLICT (expense_id, user_id) DO NOTHING;
      SET CONSTRAINTS ALL IMMEDIATE;
      SET CONSTRAINTS ALL DEFERRED;
      v_repaired_active := v_repaired_active + 1;
    ELSE
      -- Any other status is itself an anomaly outside the deterministic
      -- repairs (draft/active/settled are the only expense statuses this
      -- schema defines, but fail loudly rather than silently skipping a
      -- row an unrecognized status would otherwise slip past).
      RAISE EXCEPTION USING
        ERRCODE = 'PST07',
        MESSAGE = format(
          'payer_reachability_repair: anomaly -- orphan payer %s on expense %s has unrecognized status %s; aborting',
          v_orphan.user_id, v_orphan.expense_id, v_orphan.status
        );
    END IF;
  END LOOP;

  RAISE NOTICE 'payer_reachability_repair: % draft(s), % active/settled',
    v_repaired_drafts, v_repaired_active;
END;
$$;
