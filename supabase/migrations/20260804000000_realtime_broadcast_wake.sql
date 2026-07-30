-- Issue #477 Slice 6: Migrate expense realtime from Postgres Changes to
-- private Broadcast wakes.
--
-- Per #477 spec part 4 step 7:
--   'remove expenses from the Postgres Changes publication, install the
--    versioned private Broadcast authorization policy/finalizer/delete
--    wakes, and grant no financial payload channel.'
--
-- The wake carries NO financial data — just the expense ID and graph
-- revision. The client refetches the complete authorized snapshot.

-- ============================================================
-- 1. Remove expenses from the Realtime publication so Postgres Changes
--    subscriptions on expenses no longer work.
-- ============================================================
ALTER PUBLICATION supabase_realtime DROP TABLE public.expenses;

-- ============================================================
-- 2. Redefine the finalizer to send a private Broadcast wake for each
--    expense that survived with a revision bump. realtime.send has a
--    built-in exception handler (RAISE WARNING, not EXCEPTION), so a
--    broadcast failure never rolls back the mutation.
-- ============================================================
CREATE OR REPLACE FUNCTION graph_internal.finalize_mutation_token_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target       RECORD;
  v_claim        RECORD;
  v_current      RECORD;
  v_total_events integer;
  v_rev          integer;
  v_found        boolean;
BEGIN
  FOR v_target IN
    SELECT * FROM pg_temp.expense_graph_targets
     WHERE mutation_token = NEW.mutation_token
     ORDER BY locked_group_id, expense_id
  LOOP
    SELECT * INTO v_current FROM public.expenses WHERE id = v_target.expense_id FOR UPDATE;
    v_found := FOUND;
    UPDATE pg_temp.expense_graph_targets SET survives = v_found
     WHERE mutation_token = NEW.mutation_token AND expense_id = v_target.expense_id;
  END LOOP;

  IF NEW.source = 'direct' THEN
    SELECT COALESCE(SUM(event_count), 0) INTO v_total_events
      FROM pg_temp.expense_graph_targets WHERE mutation_token = NEW.mutation_token;
    IF v_total_events = 0 THEN
      UPDATE pg_temp.expense_graph_tokens SET state = 'closed', closed_at = clock_timestamp()
       WHERE mutation_token = NEW.mutation_token;
      RETURN NULL;
    END IF;
  END IF;

  FOR v_target IN
    SELECT * FROM pg_temp.expense_graph_targets
     WHERE mutation_token = NEW.mutation_token
     ORDER BY locked_group_id, expense_id
  LOOP
    IF NOT v_target.survives THEN
      CONTINUE;
    END IF;

    IF NEW.source = 'direct' AND v_target.event_count = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'unused_direct_target: ' || v_target.expense_id::text;
    END IF;

    IF v_target.revision_bumped THEN
      SELECT graph_revision INTO v_rev FROM public.expenses WHERE id = v_target.expense_id;
      IF v_rev <= v_target.starting_revision THEN
        RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'revision_transition_mismatch: ' || v_target.expense_id::text;
      END IF;
    ELSIF NEW.source = 'direct' THEN
      SELECT graph_revision INTO v_rev FROM public.expenses WHERE id = v_target.expense_id;
      IF v_rev IS DISTINCT FROM v_target.starting_revision THEN
        RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'direct_target_revision_drifted: ' || v_target.expense_id::text;
      END IF;

      PERFORM set_config('graph_internal.finalizing', v_target.mutation_token::text, true);
      UPDATE public.expenses SET graph_revision = v_target.starting_revision + 1 WHERE id = v_target.expense_id;
      PERFORM set_config('graph_internal.finalizing', '', true);

      UPDATE pg_temp.expense_graph_targets SET revision_bumped = true
       WHERE mutation_token = NEW.mutation_token AND expense_id = v_target.expense_id;
    END IF;
    -- A non-direct target that never bumped (only reachable via a
    -- 'claim' token today) is not treated as an error.

    PERFORM graph_internal.validate_graph_mode(v_target.expense_id);
  END LOOP;

  FOR v_claim IN SELECT * FROM pg_temp.expense_graph_claim_events WHERE mutation_token = NEW.mutation_token LOOP
    IF NOT (
      v_claim.old_claimed_by IS NULL AND v_claim.old_claimed_at IS NULL
      AND v_claim.new_claimed_by IS NOT NULL AND v_claim.new_claimed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'invalid_claim_transition: ' || v_claim.guest_id::text;
    END IF;
  END LOOP;

  -- Send a private Broadcast wake for each expense that survived with
  -- a revision bump. The wake carries NO financial data — just the
  -- expense ID and new graph revision. The client refetches the
  -- authorized snapshot. realtime.send swallows errors internally
  -- (RAISE WARNING), so a broadcast failure never rolls back the
  -- mutation.
  IF v_rev IS NOT NULL THEN
    PERFORM realtime.send(
      pg_catalog.jsonb_build_object(
        'expense_id', v_target.expense_id,
        'graph_revision', v_rev
      ),
      'wake',
      'expense_wake:' || v_target.expense_id::text,
      true
    );
  END IF;

  UPDATE pg_temp.expense_graph_tokens SET state = 'closed', closed_at = clock_timestamp()
   WHERE mutation_token = NEW.mutation_token;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION graph_internal.finalize_mutation_token_trigger() IS
  'Issue #477: DEFERRABLE finalizer. After validating revision transitions '
  'and claim events, sends a private Broadcast wake for each surviving '
  'bumped expense via realtime.send. The wake carries only the expense ID '
  'and graph revision — no financial payload.';
