-- ============================================================
-- Issue #477 invariant cutover, part 1: the expense-graph mutation-token
-- guard system.
--
-- This is the "future migration" anticipated by
-- 20260730000000_install_financial_compatibility_gate.sql's own header
-- comment. It installs the pg_temp mutation-token registry, the lexically
-- first BEFORE INSERT/UPDATE/DELETE guard triggers on `expenses` and its
-- 8 child/guest/share/participant-map/plan-header/plan-edge tables, the
-- AFTER transition collectors, the DEFERRABLE INITIALLY DEFERRED one-shot
-- finalizer, and the `groups` root-delete collector -- then, in the SAME
-- transaction, redefines every RPC that writes those 9 tables to open the
-- token the new guards require. Trigger installation and RPC redefinition
-- cannot be split across migrations: the moment the guards exist, any
-- unguarded write fails, so this file is the entire breaking change,
-- landed atomically.
--
-- Design source: a from-scratch architecture pass that independently
-- re-read every RPC body (save_expense_draft_graph, activate_expense,
-- activate_saved_expense, claim_guest_spot, confirm_chat_expense,
-- leave_group, remove_group_member) and the live DDL/FK/trigger graph for
-- all 9 tables before proposing this design; every table/RPC diff below
-- traces to a specific verified line range in an existing migration file.
--
-- Explicit, load-bearing adjustment beyond the 4 originally-named RPCs:
-- `activate_expense(uuid)` has no CAS/revision knowledge of its own (only
-- its wrapper `activate_saved_expense(uuid,integer)` does), so it cannot
-- safely open its own token without reopening the exact TOCTOU race
-- `p_expected_graph_revision` exists to close. Its `authenticated` EXECUTE
-- grant is revoked here; it remains callable only transitively, from
-- inside `activate_saved_expense`'s already-open token.
--
-- Explicit, load-bearing adjustment: `leave_group`/`remove_group_member`
-- each issue a raw `DELETE FROM public.expenses WHERE id = ANY(...)` for
-- the departing/removed member's own draft expenses. Under the new guard
-- this requires an explicit `direct` token; both are amended here.
-- ============================================================

-- ============================================================
-- 1. graph_internal: private schema, never exposed to PostgREST. Mirrors
--    financial_internal exactly (20260730000000).
-- ============================================================

CREATE SCHEMA graph_internal;

REVOKE ALL ON SCHEMA graph_internal FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON SCHEMA graph_internal IS
  'Issue #477: owner-only expense-graph mutation-token guard subsystem. '
  'Never exposed to PostgREST.';

-- ============================================================
-- 2. Registry validator + lazy initializer.
--
-- Three session-local (pg_temp) tables: expense_graph_tokens (the token
-- header / push-pop stack), expense_graph_targets (one row per
-- (mutation_token, expense_id) -- the literal registry the spec text
-- describes), and expense_graph_claim_events (one row per
-- (mutation_token, guest_id) actually touched, for claim-transition
-- validation). All three are created together, on first use in a given
-- session, and re-validated on every subsequent use in that same
-- session -- never trusted by name alone.
-- ============================================================

CREATE FUNCTION graph_internal.validate_mutation_registry()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner        oid := (SELECT proowner FROM pg_catalog.pg_proc
                           WHERE oid = 'graph_internal.validate_mutation_registry()'::regprocedure);
  v_temp_schema  oid := pg_catalog.pg_my_temp_schema();
  v_table_name   text;
  v_oid          oid;
  v_columns      text;
  v_expected     text;
  v_triggers     text;
  v_expected_trg text;
BEGIN
  IF v_temp_schema = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'no_temp_schema';
  END IF;

  FOR v_table_name IN SELECT unnest(ARRAY[
    'expense_graph_tokens', 'expense_graph_targets', 'expense_graph_claim_events'
  ])
  LOOP
    SELECT c.oid INTO v_oid
      FROM pg_catalog.pg_class c
     WHERE c.relname = v_table_name
       AND c.relnamespace = v_temp_schema
       AND c.relkind = 'r';

    IF v_oid IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'registry_table_missing: ' || v_table_name;
    END IF;

    IF (SELECT c.relpersistence FROM pg_catalog.pg_class c WHERE c.oid = v_oid) <> 't' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'registry_table_not_temporary: ' || v_table_name;
    END IF;

    IF (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = v_oid) <> v_owner THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'registry_table_wrong_owner: ' || v_table_name;
    END IF;

    IF (SELECT c.relacl FROM pg_catalog.pg_class c WHERE c.oid = v_oid) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'registry_table_has_acl: ' || v_table_name;
    END IF;

    SELECT string_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum)
      INTO v_columns
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped;

    v_expected := CASE v_table_name
      WHEN 'expense_graph_tokens' THEN
        'mutation_token:uuid,source:text,state:text,stack_depth:integer,opened_at:timestamp with time zone,' ||
        'closed_at:timestamp with time zone,group_teardown_group_id:uuid,target_count:integer'
      WHEN 'expense_graph_targets' THEN
        'mutation_token:uuid,expense_id:uuid,locked_group_id:uuid,starting_revision:integer,' ||
        'revision_bumped:boolean,event_count:integer,survives:boolean'
      WHEN 'expense_graph_claim_events' THEN
        'mutation_token:uuid,guest_id:uuid,expense_id:uuid,old_claimed_by:uuid,old_claimed_at:timestamp with time zone,' ||
        'new_claimed_by:uuid,new_claimed_at:timestamp with time zone'
    END;

    IF v_columns IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'registry_table_shape_mismatch: ' || v_table_name;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class = v_oid) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'registry_table_has_rule: ' || v_table_name;
    END IF;

    SELECT string_agg(t.tgname, ',' ORDER BY t.tgname)
      INTO v_triggers
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid = v_oid AND NOT t.tgisinternal;

    v_expected_trg := CASE v_table_name
      WHEN 'expense_graph_tokens' THEN 'deferred_finalize_expense_graph_tokens'
      ELSE NULL
    END;

    IF v_triggers IS DISTINCT FROM v_expected_trg THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'registry_table_hostile_trigger: ' || v_table_name;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.validate_mutation_registry()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION graph_internal.ensure_mutation_registry()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.to_regclass('pg_temp.expense_graph_tokens') IS NULL THEN
    CREATE TEMP TABLE expense_graph_tokens (
      mutation_token           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      source                   text        NOT NULL CHECK (source IN ('new', 'existing_save', 'activation', 'claim', 'direct', 'group_teardown')),
      state                    text        NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
      stack_depth              integer     NOT NULL CHECK (stack_depth > 0),
      opened_at                timestamptz NOT NULL DEFAULT clock_timestamp(),
      closed_at                timestamptz,
      group_teardown_group_id  uuid,
      target_count             integer     NOT NULL CHECK (target_count > 0),
      CHECK ((source = 'group_teardown') = (group_teardown_group_id IS NOT NULL))
    ) ON COMMIT DELETE ROWS;

    CREATE TEMP TABLE expense_graph_targets (
      mutation_token     uuid    NOT NULL REFERENCES pg_temp.expense_graph_tokens(mutation_token) ON DELETE CASCADE,
      expense_id         uuid    NOT NULL,
      locked_group_id    uuid    NOT NULL,
      starting_revision  integer NOT NULL CHECK (starting_revision BETWEEN 0 AND 2147483647),
      revision_bumped    boolean NOT NULL DEFAULT false,
      event_count        integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
      survives           boolean NOT NULL DEFAULT true,
      PRIMARY KEY (mutation_token, expense_id)
    ) ON COMMIT DELETE ROWS;

    CREATE TEMP TABLE expense_graph_claim_events (
      mutation_token   uuid NOT NULL REFERENCES pg_temp.expense_graph_tokens(mutation_token) ON DELETE CASCADE,
      guest_id         uuid NOT NULL,
      expense_id       uuid NOT NULL,
      old_claimed_by   uuid,
      old_claimed_at   timestamptz,
      new_claimed_by   uuid,
      new_claimed_at   timestamptz,
      PRIMARY KEY (mutation_token, guest_id)
    ) ON COMMIT DELETE ROWS;

    CREATE CONSTRAINT TRIGGER deferred_finalize_expense_graph_tokens
      AFTER INSERT ON expense_graph_tokens
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION graph_internal.finalize_mutation_token_trigger();
  ELSE
    PERFORM graph_internal.validate_mutation_registry();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.ensure_mutation_registry()
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 3. Registry helpers used by the guard/collector/finalizer and by every
--    token-opening RPC.
-- ============================================================

CREATE FUNCTION graph_internal.next_stack_depth()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_depth integer;
BEGIN
  SELECT COALESCE(MAX(stack_depth), 0) + 1 INTO v_depth FROM pg_temp.expense_graph_tokens WHERE state = 'open';
  RETURN v_depth;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.next_stack_depth()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION graph_internal.active_token_for(p_expense_id uuid, OUT mutation_token uuid, OUT source text)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT k.mutation_token, k.source
    INTO mutation_token, source
    FROM pg_temp.expense_graph_targets t
    JOIN pg_temp.expense_graph_tokens k USING (mutation_token)
   WHERE t.expense_id = p_expense_id AND k.state = 'open'
   ORDER BY k.stack_depth DESC
   LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.active_token_for(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Opens a token for exactly one named-writer target. `p_expense_id` need
-- not yet exist as a parent row (the 'new' source registers an id before
-- its INSERT); `p_starting_revision` is the caller's already-locked
-- current/expected revision (0 for a brand-new parent).
CREATE FUNCTION graph_internal.open_named_token(
  p_expense_id uuid,
  p_source text,
  p_starting_revision integer,
  p_group_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token uuid;
BEGIN
  PERFORM graph_internal.ensure_mutation_registry();

  v_token := gen_random_uuid();
  INSERT INTO pg_temp.expense_graph_tokens (mutation_token, source, state, stack_depth, target_count)
  VALUES (v_token, p_source, 'open', graph_internal.next_stack_depth(), 1);

  INSERT INTO pg_temp.expense_graph_targets (mutation_token, expense_id, locked_group_id, starting_revision)
  VALUES (v_token, p_expense_id, p_group_id, p_starting_revision);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.open_named_token(uuid, text, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION graph_internal.close_token(p_token uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE pg_temp.expense_graph_tokens SET state = 'closed', closed_at = clock_timestamp() WHERE mutation_token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.close_token(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 4. begin_expense_graph_direct_mutation: the sole entry point for raw
--    trusted graph DML. Owner-only -- REVOKEd from every role including
--    service_role, exactly like build_expense_allocation_plan_edges
--    (20260720310000). Only a direct database connection authenticated
--    as the owning role, or code already running transitively as that
--    owner inside another SECURITY DEFINER function, can invoke it.
-- ============================================================

CREATE FUNCTION public.begin_expense_graph_direct_mutation(p_expense_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token uuid;
BEGIN
  PERFORM graph_internal.ensure_mutation_registry();

  IF p_expense_ids IS NULL OR array_length(p_expense_ids, 1) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'empty_target_set';
  END IF;

  IF array_length(p_expense_ids, 1) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'too_many_targets';
  END IF;

  IF array_length(p_expense_ids, 1) <> (SELECT count(DISTINCT x) FROM unnest(p_expense_ids) AS x) THEN
    RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'duplicate_target';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_temp.expense_graph_tokens WHERE source = 'direct' AND state = 'open') THEN
    RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'direct_token_already_open';
  END IF;

  -- Discover + lock every group, then every surviving expense parent, in
  -- ascending id order -- group-first (house convention), giving the
  -- required global (group_id, expense_id) order below.
  PERFORM g.id FROM public.groups g
   WHERE g.id IN (SELECT DISTINCT e.group_id FROM public.expenses e WHERE e.id = ANY(p_expense_ids))
   ORDER BY g.id
     FOR UPDATE;

  v_token := gen_random_uuid();
  INSERT INTO pg_temp.expense_graph_tokens (mutation_token, source, state, stack_depth, target_count)
  VALUES (v_token, 'direct', 'open', graph_internal.next_stack_depth(), array_length(p_expense_ids, 1));

  -- A nonexistent id simply produces no row here ("surviving expense
  -- parents" -- an absent id is not itself an error at registration
  -- time; the finalizer's per-target "survives" check handles it).
  INSERT INTO pg_temp.expense_graph_targets (mutation_token, expense_id, locked_group_id, starting_revision)
  SELECT v_token, e.id, e.group_id, e.graph_revision
    FROM public.expenses e
   WHERE e.id = ANY(p_expense_ids)
   ORDER BY e.group_id, e.id
     FOR UPDATE;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_expense_graph_direct_mutation(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.begin_expense_graph_direct_mutation(uuid[]) IS
  'Issue #477: owner-only entry point for raw trusted graph DML. Registers '
  'every target expense_id under one direct mutation token before any '
  'guarded-table write; a registration-only token with zero graph events '
  'is an allowed no-op, but once any event occurs every registered '
  'surviving id must produce at least one.';

-- ============================================================
-- 5. Shared BEFORE INSERT OR UPDATE OR DELETE guard. One function,
--    branches on TG_TABLE_NAME (the guarded identity column is `id` for
--    `expenses`, `expense_id` for every child) and TG_OP. Authorization
--    only -- may abort the statement, never mutates beyond the token
--    bookkeeping needed to record a revision bump.
-- ============================================================

CREATE FUNCTION graph_internal.expense_graph_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active   RECORD;
  v_bumped   boolean;
  v_old_eid  uuid;
  v_new_eid  uuid;
BEGIN
  PERFORM graph_internal.ensure_mutation_registry();

  IF TG_TABLE_NAME = 'expenses' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT * INTO v_active FROM graph_internal.active_token_for(NEW.id);
      IF v_active.mutation_token IS NULL OR v_active.source <> 'new' THEN
        RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'graph_mutation_unauthorized: expenses insert';
      END IF;

      SELECT revision_bumped INTO v_bumped
        FROM pg_temp.expense_graph_targets
       WHERE mutation_token = v_active.mutation_token AND expense_id = NEW.id;

      IF NEW.graph_revision <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'graph_mutation_unauthorized: new parent must start at revision 1';
      END IF;

      UPDATE pg_temp.expense_graph_targets SET revision_bumped = true
       WHERE mutation_token = v_active.mutation_token AND expense_id = NEW.id;

      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.group_id IS DISTINCT FROM OLD.group_id
         OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
      THEN
        RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'graph_mutation_unauthorized: expenses_immutable_field_changed';
      END IF;

      -- Narrow exemption: the one-shot activation-push claim
      -- (notifyExpenseActivated, see #534/#631) sets exactly this column
      -- via the trusted admin (service_role) client, with no mutation
      -- token open -- it is a notification-delivery bookkeeping write,
      -- not a graph mutation. Require every other guarded column to be
      -- byte-identical to OLD, the transition to be NULL -> non-null
      -- (the column is set exactly once and never reset, per its own
      -- invariant), and the caller to be service_role. #631's RLS
      -- hardening already keeps every client-facing path from ever
      -- reaching this transition, but the guard must not rely on that
      -- alone as its only line of defense.
      IF current_user = 'service_role'
         AND OLD.activation_notified_at IS NULL
         AND NEW.activation_notified_at IS NOT NULL
         AND NEW.status IS NOT DISTINCT FROM OLD.status
         AND NEW.graph_revision IS NOT DISTINCT FROM OLD.graph_revision
         AND NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.merchant_name IS NOT DISTINCT FROM OLD.merchant_name
         AND NEW.expense_type IS NOT DISTINCT FROM OLD.expense_type
         AND NEW.total_amount IS NOT DISTINCT FROM OLD.total_amount
         AND NEW.service_fee_basis_points IS NOT DISTINCT FROM OLD.service_fee_basis_points
         AND NEW.fixed_fees IS NOT DISTINCT FROM OLD.fixed_fees
      THEN
        RETURN NEW;
      END IF;

      SELECT * INTO v_active FROM graph_internal.active_token_for(OLD.id);
      IF v_active.mutation_token IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'graph_mutation_unauthorized: no open token for expense';
      END IF;

      IF NEW.graph_revision IS DISTINCT FROM OLD.graph_revision THEN
        IF NEW.graph_revision IS DISTINCT FROM OLD.graph_revision + 1 THEN
          RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'graph_mutation_unauthorized: graph_revision must advance by exactly one';
        END IF;

        IF v_active.source = 'direct'
           AND current_setting('graph_internal.finalizing', true) IS DISTINCT FROM v_active.mutation_token::text
        THEN
          RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'graph_mutation_unauthorized: direct token cannot bump revision inline';
        END IF;

        SELECT revision_bumped INTO v_bumped
          FROM pg_temp.expense_graph_targets
         WHERE mutation_token = v_active.mutation_token AND expense_id = OLD.id;

        IF v_bumped THEN
          RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'graph_mutation_unauthorized: revision already advanced under this token';
        END IF;

        UPDATE pg_temp.expense_graph_targets SET revision_bumped = true
         WHERE mutation_token = v_active.mutation_token AND expense_id = OLD.id;
      END IF;

      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      SELECT * INTO v_active FROM graph_internal.active_token_for(OLD.id);
      IF v_active.mutation_token IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = 'graph_mutation_unauthorized: expenses delete';
      END IF;
      RETURN OLD;
    END IF;
  END IF;

  -- The 8 children: expense_id is the guarded identity column in every case.
  IF TG_OP = 'DELETE' THEN
    v_old_eid := OLD.expense_id;
    SELECT * INTO v_active FROM graph_internal.active_token_for(v_old_eid);
    IF v_active.mutation_token IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = format('graph_mutation_unauthorized: %s delete', TG_TABLE_NAME);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new_eid := NEW.expense_id;
    SELECT * INTO v_active FROM graph_internal.active_token_for(v_new_eid);
    IF v_active.mutation_token IS NULL OR v_active.source = 'group_teardown' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = format('graph_mutation_unauthorized: %s insert', TG_TABLE_NAME);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE on a child.
  v_old_eid := OLD.expense_id;
  v_new_eid := NEW.expense_id;

  IF v_new_eid IS NOT DISTINCT FROM v_old_eid THEN
    SELECT * INTO v_active FROM graph_internal.active_token_for(v_new_eid);
    IF v_active.mutation_token IS NULL OR v_active.source = 'group_teardown' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = format('graph_mutation_unauthorized: %s update', TG_TABLE_NAME);
    END IF;
    RETURN NEW;
  END IF;

  -- Retargeting UPDATE: both OLD and NEW parents must already be
  -- registered/locked under an open, non-group_teardown token.
  SELECT * INTO v_active FROM graph_internal.active_token_for(v_old_eid);
  IF v_active.mutation_token IS NULL OR v_active.source = 'group_teardown' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = format('graph_mutation_unauthorized: %s retarget (old)', TG_TABLE_NAME);
  END IF;
  SELECT * INTO v_active FROM graph_internal.active_token_for(v_new_eid);
  IF v_active.mutation_token IS NULL OR v_active.source = 'group_teardown' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST10', MESSAGE = format('graph_mutation_unauthorized: %s retarget (new)', TG_TABLE_NAME);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.expense_graph_row_guard()
  FROM PUBLIC, anon, authenticated, service_role;

-- Lexically first: "000_" (0x30) sorts before every existing trigger name
-- on these tables (both begin with a lowercase letter, 0x74/0x72/etc.),
-- and reserves the "000_" prefix for any future sibling guard.
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_shares
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_payers
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_guests
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_guest_shares
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_allocation_entities
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_balance_allocation_plans
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();
CREATE TRIGGER "000_expense_graph_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_balance_allocations
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_guard();

-- ============================================================
-- 6. Shared AFTER transition collector: pure bookkeeping over an
--    already-authorized event (never aborts). Increments the winning
--    token's per-target event_count, and, only for expense_guests
--    claim-state changes, records the exact old/new claimed_by/
--    claimed_at snapshot for the finalizer's transition validation.
-- ============================================================

CREATE FUNCTION graph_internal.expense_graph_row_collector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expense_id uuid;
  v_active     RECORD;
BEGIN
  PERFORM graph_internal.ensure_mutation_registry();

  IF TG_TABLE_NAME = 'expenses' THEN
    v_expense_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_expense_id := COALESCE(NEW.expense_id, OLD.expense_id);
  END IF;

  SELECT * INTO v_active FROM graph_internal.active_token_for(v_expense_id);
  -- v_active.mutation_token is guaranteed non-null: the BEFORE guard
  -- already required an open token for this exact expense_id.
  UPDATE pg_temp.expense_graph_targets SET event_count = event_count + 1
   WHERE mutation_token = v_active.mutation_token AND expense_id = v_expense_id;

  IF TG_TABLE_NAME = 'expense_guests' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.claimed_by IS DISTINCT FROM OLD.claimed_by OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
        INSERT INTO pg_temp.expense_graph_claim_events
          (mutation_token, guest_id, expense_id, old_claimed_by, old_claimed_at, new_claimed_by, new_claimed_at)
        VALUES (v_active.mutation_token, NEW.id, NEW.expense_id, OLD.claimed_by, OLD.claimed_at, NEW.claimed_by, NEW.claimed_at);
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.expense_graph_row_collector()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();
CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();
CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_shares
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();
CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_payers
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();
CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_guests
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();
CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_guest_shares
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();
CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_allocation_entities
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();
CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_balance_allocation_plans
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();
CREATE TRIGGER "900_expense_graph_collector"
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_balance_allocations
  FOR EACH ROW EXECUTE FUNCTION graph_internal.expense_graph_row_collector();

-- ============================================================
-- 7. validate_graph_mode: re-runs the same invariants each RPC already
--    checks inline, generically over the current committed-transaction
--    rows, as defense in depth for owner/trusted direct SQL. Never
--    replaces or changes RPC error precedence (#477).
-- ============================================================

CREATE FUNCTION graph_internal.validate_graph_mode(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_status = 'draft' THEN
    IF EXISTS (SELECT 1 FROM public.expense_allocation_entities WHERE expense_id = p_expense_id)
       OR EXISTS (SELECT 1 FROM public.expense_balance_allocation_plans WHERE expense_id = p_expense_id)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt: draft has an allocation plan';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.expense_guest_shares gs
        JOIN public.expense_guests g ON g.id = gs.guest_id
       WHERE gs.expense_id = p_expense_id AND g.claimed_by IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt: claimed guest still has a guest share';
    END IF;

    RETURN;
  END IF;

  IF v_status = 'active' OR v_status = 'settled' THEN
    -- Contiguous allocation_index starting at 1.
    IF EXISTS (
      SELECT 1 FROM (
        SELECT allocation_index,
               row_number() OVER (ORDER BY allocation_index)::integer AS expected_index
          FROM public.expense_balance_allocations
         WHERE expense_id = p_expense_id
      ) x
       WHERE allocation_index <> expected_index
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt: non-contiguous allocation_index';
    END IF;

    -- Every edge: positive amount, debtor != creditor.
    IF EXISTS (
      SELECT 1 FROM public.expense_balance_allocations
       WHERE expense_id = p_expense_id AND (amount_cents <= 0 OR debtor_index = creditor_index)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt: invalid edge (amount or self-loop)';
    END IF;

    -- Guests are never creditors.
    IF EXISTS (
      SELECT 1
        FROM public.expense_balance_allocations ea
        JOIN public.expense_allocation_entities c
          ON c.expense_id = ea.expense_id AND c.participant_index = ea.creditor_index
       WHERE ea.expense_id = p_expense_id AND c.entity_kind = 'guest'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt: guest is a creditor';
    END IF;

    -- Per-entity incidence (outgoing - incoming) == net for every entity.
    IF EXISTS (
      WITH flows AS (
        SELECT debtor_index AS idx, amount_cents AS out_amt, 0 AS in_amt
          FROM public.expense_balance_allocations WHERE expense_id = p_expense_id
        UNION ALL
        SELECT creditor_index, 0, amount_cents
          FROM public.expense_balance_allocations WHERE expense_id = p_expense_id
      ),
      incidence AS (
        SELECT idx, COALESCE(SUM(out_amt), 0) - COALESCE(SUM(in_amt), 0) AS net_flow
          FROM flows GROUP BY idx
      )
      SELECT 1
        FROM public.expense_allocation_entities e
        LEFT JOIN incidence i ON i.idx = e.participant_index
       WHERE e.expense_id = p_expense_id
         AND COALESCE(i.net_flow, 0) <> e.net_amount_cents
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt: incidence != net';
    END IF;

    -- Total positive debt == total credit.
    IF (SELECT COALESCE(SUM(amount_cents), 0) FROM public.expense_balance_allocations WHERE expense_id = p_expense_id)
       <> (SELECT COALESCE(SUM(net_amount_cents), 0) FROM public.expense_allocation_entities
            WHERE expense_id = p_expense_id AND net_amount_cents > 0)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt: total debt != total credit';
    END IF;
  END IF;
  -- 'settled' currently reuses the 'active' checks above: no RPC in this
  -- repo transitions an expense to 'settled' today, so a distinct
  -- persisted_settled invariant set would be invented rather than
  -- verified. The allocation graph invariants active enforces do not
  -- become weaker after settlement.
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.validate_graph_mode(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 8. Deferred one-shot finalizer. Referenced by ensure_mutation_registry
--    (section 2) before this function is created in file order; that is
--    safe because ensure_mutation_registry's body is only executed at
--    runtime, well after this entire migration has finished applying.
-- ============================================================

CREATE FUNCTION graph_internal.finalize_mutation_token_trigger()
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
    -- 'claim' token today) is not treated as an error: no RPC obligates
    -- claim to bump the revision (see migration header / PR notes).

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

  UPDATE pg_temp.expense_graph_tokens SET state = 'closed', closed_at = clock_timestamp()
   WHERE mutation_token = NEW.mutation_token;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.finalize_mutation_token_trigger()
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 9. groups root-delete collector: opens a delete-only 'group_teardown'
--    token for every expense the group still has, BEFORE the physical
--    group row delete and therefore before the FK-cascade AFTER trigger
--    that removes those expenses can begin (Postgres fires a table's
--    BEFORE ROW triggers, then the physical delete, then AFTER ROW
--    triggers -- which is where FK-cascade actions run -- so this
--    collector's registration is always complete before the cascade
--    starts). Also scrubs any live expense_graph_save_operations ledger
--    rows for those expenses to an ownerless group_deleted tombstone,
--    mirroring the existing retire_chat_expense_confirmations_for_group
--    pattern for the identical reason: that ledger's expense_id FK is
--    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED (20260720700000),
--    so an un-scrubbed committed row would abort the whole teardown at
--    commit. Performs zero permission checks -- delete_group(uuid)
--    (20260716000000) remains the sole authorization boundary for
--    deleting a group at all.
-- ============================================================

CREATE FUNCTION graph_internal.groups_teardown_collector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token uuid;
BEGIN
  PERFORM graph_internal.ensure_mutation_registry();

  v_token := gen_random_uuid();
  INSERT INTO pg_temp.expense_graph_tokens
    (mutation_token, source, state, stack_depth, target_count, group_teardown_group_id)
  VALUES (
    v_token, 'group_teardown', 'open', graph_internal.next_stack_depth(),
    GREATEST(1, (SELECT count(*) FROM public.expenses WHERE group_id = OLD.id)),
    OLD.id
  );

  INSERT INTO pg_temp.expense_graph_targets (mutation_token, expense_id, locked_group_id, starting_revision)
  SELECT v_token, e.id, e.group_id, e.graph_revision
    FROM public.expenses e
   WHERE e.group_id = OLD.id
   ORDER BY e.id
     FOR UPDATE;

  UPDATE public.expense_graph_save_operations
     SET outcome = 'retired', caller_id = NULL, group_id = NULL, canonical_request = NULL,
         request_digest = NULL, expense_id = NULL, graph_revision = NULL, result = NULL,
         result_created_at = NULL, retired_reason = 'group_deleted', retired_at = statement_timestamp()
   WHERE expense_id IN (SELECT id FROM public.expenses WHERE group_id = OLD.id)
     AND outcome = 'committed';

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION graph_internal.groups_teardown_collector()
  FROM PUBLIC, anon, authenticated, service_role;

-- Sorts before the existing trg_retire_chat_expense_confirmations_for_group
-- (0x30 < 0x74), same lexical-first argument as every "000_" guard above.
CREATE TRIGGER "000_expense_graph_teardown"
  BEFORE DELETE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION graph_internal.groups_teardown_collector();

-- ============================================================
-- 10. activate_saved_expense: opens the 'activation' token right after
--     its existing group-first lock + CAS check, before the nested
--     activate_expense() call whose writes now require it; the trailing
--     UPDATE ... SET graph_revision = v_revision + 1 is unchanged (it
--     already performs exactly the one OLD+1 transition the guard
--     expects). Every other statement in this function is unchanged
--     from 20260729100000's definition.
-- ============================================================

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
  v_caller             uuid := auth.uid();
  v_candidate_group_id uuid;
  v_expense            public.expenses%ROWTYPE;
  v_revision           integer;
  v_token              uuid;
  v_maintenance        boolean;
BEGIN
  -- #477/#495: "Run #477's financial compatibility guard as the first
  -- body action and require authentication." financial_internal is
  -- revoked from every PostgREST role, but this SECURITY DEFINER
  -- function runs with its owner's privileges regardless of caller.
  SELECT maintenance INTO v_maintenance
    FROM financial_internal.financial_compatibility_state
   WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION USING ERRCODE = 'PST09', MESSAGE = 'financial_maintenance';
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'auth_required';
  END IF;

  SELECT group_id INTO v_candidate_group_id
    FROM public.expenses
   WHERE id = p_expense_id;

  IF v_candidate_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  PERFORM id FROM public.groups WHERE id = v_candidate_group_id FOR UPDATE;

  SELECT *
    INTO v_expense
    FROM public.expenses
   WHERE id = p_expense_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_expense.group_id IS DISTINCT FROM v_candidate_group_id
     OR v_expense.creator_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  IF p_expected_graph_revision IS NULL
     OR p_expected_graph_revision <> v_expense.graph_revision
     OR v_expense.status <> 'draft'
     OR v_expense.graph_revision = 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'stale_graph_revision';
  END IF;

  -- #495 spec: "reconstruct persisted graph and run PST07/orphan_payer_state
  -- reachability before payer sums, allocation-plan construction, balances,
  -- status, message, or event work." The composite expense_payers_
  -- participant_fkey now makes this structurally unreachable for any
  -- normally-persisted draft -- this is deliberate defense in depth for a
  -- corrupt state that could otherwise only arise from a direct-connection
  -- bypass, so it never fires in ordinary operation.
  IF EXISTS (
    SELECT 1
      FROM public.expense_payers ep
     WHERE ep.expense_id = p_expense_id
       AND NOT EXISTS (
         SELECT 1 FROM public.expense_shares es
          WHERE es.expense_id = ep.expense_id
            AND es.user_id = ep.user_id
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'orphan_payer_state';
  END IF;

  v_revision := v_expense.graph_revision;

  v_token := graph_internal.open_named_token(p_expense_id, 'activation', v_revision, v_candidate_group_id);

  -- activate_expense re-locks the same already-held groups row
  -- internally; PostgreSQL row locks are reentrant within one
  -- transaction, so this is a no-op wait, never a second acquisition.
  -- Its writes to expense_allocation_entities/expense_balance_
  -- allocation_plans/expense_balance_allocations/expenses(status) all
  -- resolve to this already-open 'activation' token.
  PERFORM public.activate_expense(p_expense_id);

  UPDATE public.expenses
     SET graph_revision = v_revision + 1
   WHERE id = p_expense_id;

  PERFORM graph_internal.close_token(v_token);

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

-- ============================================================
-- 11. activate_expense(uuid) has no CAS/revision knowledge of its own --
--     only its wrapper activate_saved_expense does -- so it cannot
--     safely open its own token without reopening the exact TOCTOU race
--     p_expected_graph_revision exists to close. It currently also
--     grants EXECUTE to anon and service_role (a pre-existing broad
--     grant, not scoped to authenticated alone) -- revoke from every
--     role, matching build_expense_allocation_plan_edges' "owner-only,
--     called only transitively" precedent (20260720310000). Its own
--     body needs no other changes: every one of its writes resolves to
--     whichever token its caller already opened.
-- ============================================================

REVOKE ALL ON FUNCTION public.activate_expense(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- 12. claim_guest_spot: opens the 'claim' token right after the guest
--     share lock, after the already-claimed idempotent-replay branch
--     (which performs zero writes and must open no token -- "same-caller
--     claim replay opens no token because it performs no mutation on a
--     pure replay path") and the duplicate-participant check. Every
--     write below the insertion point is unchanged from
--     20260720500000's definition; claim never bumps graph_revision
--     (no RPC obligates it to -- see the migration header note).
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_guest_ref        RECORD;
  v_group            RECORD;
  v_expense          RECORD;
  v_guest            RECORD;
  v_guest_share      RECORD;
  v_existing         uuid;
  v_guest_entity_idx integer;
  v_pending_sum      integer := 0;
  r_edge             RECORD;
  v_user_a           uuid;
  v_user_b           uuid;
  v_delta            integer;
  v_token            uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  SELECT eg.id AS guest_id, eg.expense_id, e.group_id
    INTO v_guest_ref
    FROM public.expense_guests eg
    LEFT JOIN public.expenses e ON e.id = eg.expense_id
   WHERE eg.claim_token = p_claim_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: claim token not found';
  END IF;

  IF v_guest_ref.group_id IS NULL THEN
    RAISE EXCEPTION 'expense_not_found: associated expense does not exist';
  END IF;

  SELECT g.id
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_guest_ref.group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  SELECT e.*
    INTO v_expense
    FROM public.expenses e
   WHERE e.id = v_guest_ref.expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: associated expense does not exist';
  END IF;

  IF v_expense.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  SELECT eg.*
    INTO v_guest
    FROM public.expense_guests eg
   WHERE eg.id = v_guest_ref.guest_id
     AND eg.claim_token = p_claim_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token: claim token not found';
  END IF;

  IF v_guest.expense_id IS DISTINCT FROM v_expense.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  -- Already-claimed: idempotent for the same caller (zero writes, no
  -- token), denied for any other caller.
  IF v_guest.claimed_by IS NOT NULL THEN
    IF v_guest.claimed_by = v_caller_id THEN
      SELECT e.participant_index
        INTO v_guest_entity_idx
        FROM public.expense_allocation_entities e
       WHERE e.expense_id = v_guest.expense_id
         AND e.guest_id = v_guest.id;

      IF v_guest_entity_idx IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.expense_balance_allocations ea
         WHERE ea.expense_id = v_guest.expense_id
           AND ea.debtor_index = v_guest_entity_idx
           AND ea.applied_to_user_id IS DISTINCT FROM v_caller_id
      ) THEN
        RAISE EXCEPTION 'allocation_state_corrupt: pending guest edge not applied to caller'
          USING ERRCODE = 'PST07';
      END IF;

      RETURN jsonb_build_object(
        'guest_id', v_guest.id,
        'expense_id', v_guest.expense_id,
        'already_claimed', true
      );
    END IF;

    RAISE EXCEPTION 'already_claimed: this guest spot has been claimed by another user'
      USING ERRCODE = 'PST05';
  END IF;

  SELECT id
    INTO v_existing
    FROM public.expense_shares
   WHERE expense_id = v_guest.expense_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    RAISE EXCEPTION 'duplicate_participant: you already have a share on this expense';
  END IF;

  SELECT egs.*
    INTO v_guest_share
    FROM public.expense_guest_shares egs
   WHERE egs.guest_id = v_guest.id
     AND egs.expense_id = v_guest.expense_id
     FOR UPDATE;

  v_token := graph_internal.open_named_token(v_guest.expense_id, 'claim', v_expense.graph_revision, v_group.id);

  IF v_expense.status = 'active' THEN
    SELECT e.participant_index
      INTO v_guest_entity_idx
      FROM public.expense_allocation_entities e
     WHERE e.expense_id = v_guest.expense_id
       AND e.guest_id = v_guest.id;

    IF v_guest_entity_idx IS NOT NULL THEN
      SELECT COALESCE(SUM(ea.amount_cents), 0)
        INTO v_pending_sum
        FROM public.expense_balance_allocations ea
       WHERE ea.expense_id = v_guest.expense_id
         AND ea.debtor_index = v_guest_entity_idx
         AND ea.applied_to_user_id IS NULL;

      IF COALESCE(v_guest_share.share_amount_cents, 0) <> v_pending_sum THEN
        RAISE EXCEPTION 'allocation_state_corrupt: pending guest edges (%) != guest share (%)',
          v_pending_sum, COALESCE(v_guest_share.share_amount_cents, 0)
          USING ERRCODE = 'PST07';
      END IF;

      FOR r_edge IN
        SELECT ea.allocation_index,
               ea.amount_cents,
               c.user_id AS creditor_user
          FROM public.expense_balance_allocations ea
          JOIN public.expense_allocation_entities c
            ON c.expense_id = ea.expense_id
           AND c.participant_index = ea.creditor_index
         WHERE ea.expense_id = v_guest.expense_id
           AND ea.debtor_index = v_guest_entity_idx
           AND ea.applied_to_user_id IS NULL
         ORDER BY ea.allocation_index
      LOOP
        IF r_edge.creditor_user IS DISTINCT FROM v_caller_id THEN
          IF v_caller_id < r_edge.creditor_user THEN
            v_user_a := v_caller_id;
            v_user_b := r_edge.creditor_user;
            v_delta  := r_edge.amount_cents;
          ELSE
            v_user_a := r_edge.creditor_user;
            v_user_b := v_caller_id;
            v_delta  := -r_edge.amount_cents;
          END IF;

          INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
          VALUES (v_expense.group_id, v_user_a, v_user_b, v_delta)
          ON CONFLICT (group_id, user_a, user_b)
          DO UPDATE SET
            amount_cents = public.balances.amount_cents + EXCLUDED.amount_cents,
            updated_at = now();
        END IF;

        UPDATE public.expense_balance_allocations
           SET applied_to_user_id = v_caller_id,
               applied_at = statement_timestamp()
         WHERE expense_id = v_guest.expense_id
           AND allocation_index = r_edge.allocation_index;
      END LOOP;
    END IF;
  END IF;

  IF v_guest_share IS NOT NULL THEN
    INSERT INTO public.expense_shares (expense_id, user_id, share_amount_cents)
    VALUES (v_guest.expense_id, v_caller_id, v_guest_share.share_amount_cents);

    DELETE FROM public.expense_guest_shares
     WHERE guest_id = v_guest.id
       AND expense_id = v_guest.expense_id;
  END IF;

  UPDATE public.expense_guests
     SET claimed_by = v_caller_id,
         claimed_at = now()
   WHERE id = v_guest.id;

  INSERT INTO public.group_members (group_id, user_id, status, invited_by, accepted_at)
  VALUES (v_expense.group_id, v_caller_id, 'accepted', v_expense.creator_id, now())
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET status = 'accepted',
        accepted_at = COALESCE(public.group_members.accepted_at, now())
    WHERE public.group_members.status != 'accepted';

  UPDATE public.expenses
     SET updated_at = now()
   WHERE id = v_guest.expense_id;

  PERFORM graph_internal.close_token(v_token);

  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'already_claimed', false
  );
END;
$$;


-- ============================================================
-- 13. save_expense_draft_graph: opens its token at the start of the
--     write phase, after every read-side check (replay, authority, CAS,
--     full graph decode) has already passed. New-parent path: the
--     expense id must now be pre-generated BEFORE the token opens (the
--     guard's INSERT rule requires a 'new'-source token already
--     registered for the exact NEW.id, which is impossible for an id
--     the INSERT statement itself would otherwise generate via DEFAULT
--     gen_random_uuid() -- `RETURNING id INTO v_expense_id` becomes
--     dead code and is dropped). Existing-parent path: opens
--     'existing_save' with the already-locked current revision as
--     starting_revision; the single UPDATE's graph_revision = v_next_revision
--     (== starting_revision + 1) is exactly the one authorized OLD+1
--     transition. Every other statement (validation, child
--     delete/insert loops, operation-ledger insert) is unchanged from
--     20260726200000's definition.
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_expense_draft_graph(
  p_expense                 jsonb,
  p_items                   jsonb,
  p_shares                  jsonb,
  p_payers                  jsonb,
  p_guests                  jsonb,
  p_guest_shares            jsonb,
  p_participant_order       jsonb,
  p_expected_graph_revision integer,
  p_save_operation_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller                    uuid := auth.uid();
  v_group                     public.groups%ROWTYPE;
  v_expense                   public.expenses%ROWTYPE;
  v_operation                 public.expense_graph_save_operations%ROWTYPE;
  v_member_status              text;
  v_requested_group_id        uuid;
  v_candidate_group_id        uuid;
  v_expense_id                uuid;
  v_is_new                    boolean;
  v_canonical_request         jsonb;
  v_result                    jsonb;
  v_next_revision             integer;
  v_title                     text;
  v_merchant_name             text;
  v_expense_type              text;
  v_total_amount               integer;
  v_service_fee_basis_points  integer;
  v_service_fee_percent       numeric(5,2);
  v_fixed_fees                integer;
  v_numeric                   numeric;
  v_item                      jsonb;
  v_share                     jsonb;
  v_payer                     jsonb;
  v_guest                     jsonb;
  v_guest_share               jsonb;
  v_guest_id                  uuid;
  v_user_id                   uuid;
  v_guest_local_id            text;
  v_quantity                  integer;
  v_unit_price_cents          integer;
  v_total_price_cents         integer;
  v_share_amount_cents        integer;
  v_payer_amount_cents        integer;
  v_expected_line_total       bigint;
  v_user_share_ids            uuid[] := ARRAY[]::uuid[];
  v_payer_user_ids            uuid[] := ARRAY[]::uuid[];
  v_guest_local_ids           text[] := ARRAY[]::text[];
  v_guest_share_local_ids     text[] := ARRAY[]::text[];
  v_user_share_total          bigint := 0;
  v_guest_share_total         bigint := 0;
  v_payer_total                bigint := 0;
  v_protected_claimant_id     uuid;
  v_token                     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'auth_required';
  END IF;

  IF p_save_operation_id IS NULL
     OR p_expected_graph_revision IS NULL
     OR p_expected_graph_revision < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  IF p_expense IS NULL
     OR pg_catalog.jsonb_typeof(p_expense) <> 'object'
     OR NOT (p_expense ?& ARRAY[
       'group_id',
       'title',
       'merchant_name',
       'expense_type',
       'total_amount',
       'service_fee_basis_points',
       'fixed_fees'
     ])
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_object_keys(p_expense) AS keys(key_name)
        WHERE keys.key_name NOT IN (
          'id',
          'group_id',
          'title',
          'merchant_name',
          'expense_type',
          'total_amount',
          'service_fee_basis_points',
          'fixed_fees'
        )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  IF pg_catalog.jsonb_typeof(p_expense -> 'group_id') <> 'string' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  BEGIN
    v_requested_group_id := (p_expense ->> 'group_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END;

  v_is_new := NOT (p_expense ? 'id');
  IF NOT v_is_new THEN
    IF pg_catalog.jsonb_typeof(p_expense -> 'id') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    BEGIN
      v_expense_id := (p_expense ->> 'id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END;
  END IF;

  v_canonical_request := pg_catalog.jsonb_build_object(
    'expense', p_expense,
    'items', p_items,
    'shares', p_shares,
    'payers', p_payers,
    'guests', p_guests,
    'guest_shares', p_guest_shares,
    'participant_order', p_participant_order,
    'expected_graph_revision', p_expected_graph_revision
  );

  IF v_is_new THEN
    v_candidate_group_id := v_requested_group_id;
  ELSE
    SELECT e.group_id
      INTO v_candidate_group_id
      FROM public.expenses e
     WHERE e.id = v_expense_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;
  END IF;

  SELECT *
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_candidate_group_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'expense_graph_save:' || p_save_operation_id::text,
      477
    )
  );

  SELECT *
    INTO v_operation
    FROM public.expense_graph_save_operations o
   WHERE o.operation_id = p_save_operation_id;

  IF FOUND THEN
    IF v_operation.outcome = 'retired' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST06', MESSAGE = 'operation_retired';
    END IF;

    IF v_operation.outcome <> 'committed'
       OR v_operation.caller_id IS DISTINCT FROM v_caller
       OR v_operation.group_id IS DISTINCT FROM v_group.id
       OR v_operation.canonical_request IS DISTINCT FROM v_canonical_request THEN
      RAISE EXCEPTION USING ERRCODE = 'PST06', MESSAGE = 'operation_conflict';
    END IF;

    IF v_operation.expense_id IS NULL OR v_operation.graph_revision IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'id', v_operation.expense_id,
      'graph_revision', v_operation.graph_revision
    );
  END IF;

  IF v_group.creator_id IS DISTINCT FROM v_caller THEN
    SELECT gm.status::text
      INTO v_member_status
      FROM public.group_members gm
     WHERE gm.group_id = v_group.id
       AND gm.user_id = v_caller
     FOR UPDATE;

    IF NOT FOUND OR v_member_status <> 'accepted' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;
  END IF;

  IF v_is_new THEN
    IF p_expected_graph_revision <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_next_revision := 1;
  ELSE
    SELECT *
      INTO v_expense
      FROM public.expenses e
     WHERE e.id = v_expense_id
     FOR UPDATE;

    IF NOT FOUND OR v_expense.group_id IS DISTINCT FROM v_group.id THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;

    IF v_expense.creator_id IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
    END IF;

    IF v_requested_group_id IS DISTINCT FROM v_group.id THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    IF v_expense.status <> 'draft'
       OR p_expected_graph_revision <> v_expense.graph_revision
       OR v_expense.graph_revision = 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'stale_graph_revision';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.expense_allocation_entities e
       WHERE e.expense_id = v_expense.id
    ) OR EXISTS (
      SELECT 1
        FROM public.expense_balance_allocation_plans p
       WHERE p.expense_id = v_expense.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.expense_guest_shares gs
        JOIN public.expense_guests g ON g.id = gs.guest_id
       WHERE gs.expense_id = v_expense.id
         AND g.claimed_by IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'graph_state_corrupt';
    END IF;

    v_next_revision := v_expense.graph_revision + 1;
  END IF;

  IF pg_catalog.jsonb_typeof(p_expense -> 'title') <> 'string'
     OR (pg_catalog.jsonb_typeof(p_expense -> 'merchant_name') <> 'string'
         AND pg_catalog.jsonb_typeof(p_expense -> 'merchant_name') <> 'null')
     OR pg_catalog.jsonb_typeof(p_expense -> 'expense_type') <> 'string'
     OR pg_catalog.jsonb_typeof(p_expense -> 'total_amount') <> 'number'
     OR pg_catalog.jsonb_typeof(p_expense -> 'service_fee_basis_points') <> 'number'
     OR pg_catalog.jsonb_typeof(p_expense -> 'fixed_fees') <> 'number' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  v_title := p_expense ->> 'title';
  v_merchant_name := CASE
    WHEN pg_catalog.jsonb_typeof(p_expense -> 'merchant_name') = 'null' THEN NULL
    ELSE p_expense ->> 'merchant_name'
  END;
  v_expense_type := p_expense ->> 'expense_type';

  IF v_expense_type NOT IN ('itemized', 'single_amount') THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  v_numeric := (p_expense ->> 'total_amount')::numeric;
  IF v_numeric <> pg_catalog.trunc(v_numeric)
     OR v_numeric < 0
     OR v_numeric > public.expense_money_max_cents() THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;
  v_total_amount := v_numeric::integer;

  v_numeric := (p_expense ->> 'service_fee_basis_points')::numeric;
  IF v_numeric <> pg_catalog.trunc(v_numeric)
     OR v_numeric < 0
     OR v_numeric > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;
  v_service_fee_basis_points := v_numeric::integer;
  v_service_fee_percent := v_service_fee_basis_points::numeric / 100;

  v_numeric := (p_expense ->> 'fixed_fees')::numeric;
  IF v_numeric <> pg_catalog.trunc(v_numeric)
     OR v_numeric < 0
     OR v_numeric > public.expense_money_max_cents() THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;
  v_fixed_fees := v_numeric::integer;

  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR p_shares IS NULL OR pg_catalog.jsonb_typeof(p_shares) <> 'array'
     OR p_payers IS NULL OR pg_catalog.jsonb_typeof(p_payers) <> 'array'
     OR p_guests IS NULL OR pg_catalog.jsonb_typeof(p_guests) <> 'array'
     OR p_guest_shares IS NULL OR pg_catalog.jsonb_typeof(p_guest_shares) <> 'array'
     OR p_participant_order IS NULL
     OR pg_catalog.jsonb_typeof(p_participant_order) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  IF pg_catalog.jsonb_array_length(p_participant_order) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'participant_order_unsupported';
  END IF;

  IF pg_catalog.jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
       OR NOT (v_item ?& ARRAY[
         'description',
         'quantity',
         'unit_price_cents',
         'total_price_cents'
       ])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_item) AS keys(key_name)
          WHERE keys.key_name NOT IN (
            'description',
            'quantity',
            'unit_price_cents',
            'total_price_cents'
          )
       )
       OR pg_catalog.jsonb_typeof(v_item -> 'description') <> 'string'
       OR pg_catalog.jsonb_typeof(v_item -> 'quantity') <> 'number'
       OR pg_catalog.jsonb_typeof(v_item -> 'unit_price_cents') <> 'number'
       OR pg_catalog.jsonb_typeof(v_item -> 'total_price_cents') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_numeric := (v_item ->> 'quantity')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 1
       OR v_numeric > 999999999 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_quantity := v_numeric::integer;

    v_numeric := (v_item ->> 'unit_price_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 1
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_unit_price_cents := v_numeric::integer;

    v_numeric := (v_item ->> 'total_price_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 1
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_total_price_cents := v_numeric::integer;

    v_expected_line_total := public.compute_expense_line_total_cents(
      v_quantity,
      v_unit_price_cents
    );
    IF v_expected_line_total > public.expense_money_max_cents()
       OR v_total_price_cents <> v_expected_line_total THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
  END LOOP;

  FOR v_share IN SELECT value FROM pg_catalog.jsonb_array_elements(p_shares)
  LOOP
    IF pg_catalog.jsonb_typeof(v_share) <> 'object'
       OR NOT (v_share ?& ARRAY['user_id', 'share_amount_cents'])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_share) AS keys(key_name)
          WHERE keys.key_name NOT IN ('user_id', 'share_amount_cents')
       )
       OR pg_catalog.jsonb_typeof(v_share -> 'user_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_share -> 'share_amount_cents') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    BEGIN
      v_user_id := (v_share ->> 'user_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END;

    IF pg_catalog.array_position(v_user_share_ids, v_user_id) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    IF v_user_id IS DISTINCT FROM v_group.creator_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.group_members gm
          WHERE gm.group_id = v_group.id
            AND gm.user_id = v_user_id
            AND gm.status = 'accepted'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'share_not_group_participant';
    END IF;

    v_numeric := (v_share ->> 'share_amount_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 0
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_share_amount_cents := v_numeric::integer;

    v_user_share_ids := pg_catalog.array_append(v_user_share_ids, v_user_id);
    v_user_share_total := v_user_share_total + v_share_amount_cents;
    IF v_user_share_total > v_total_amount THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
  END LOOP;

  FOR v_guest IN SELECT value FROM pg_catalog.jsonb_array_elements(p_guests)
  LOOP
    IF pg_catalog.jsonb_typeof(v_guest) <> 'object'
       OR NOT (v_guest ?& ARRAY['local_id', 'display_name'])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_guest) AS keys(key_name)
          WHERE keys.key_name NOT IN ('local_id', 'display_name')
       )
       OR pg_catalog.jsonb_typeof(v_guest -> 'local_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_guest -> 'display_name') <> 'string' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_guest_local_id := v_guest ->> 'local_id';
    IF v_guest_local_id = ''
       OR pg_catalog.array_position(v_guest_local_ids, v_guest_local_id) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_guest_local_ids := pg_catalog.array_append(v_guest_local_ids, v_guest_local_id);
  END LOOP;

  FOR v_guest_share IN SELECT value FROM pg_catalog.jsonb_array_elements(p_guest_shares)
  LOOP
    IF pg_catalog.jsonb_typeof(v_guest_share) <> 'object'
       OR NOT (v_guest_share ?& ARRAY['local_id', 'share_amount_cents'])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_guest_share) AS keys(key_name)
          WHERE keys.key_name NOT IN ('local_id', 'share_amount_cents')
       )
       OR pg_catalog.jsonb_typeof(v_guest_share -> 'local_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_guest_share -> 'share_amount_cents') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_guest_local_id := v_guest_share ->> 'local_id';
    IF v_guest_local_id = ''
       OR pg_catalog.array_position(v_guest_share_local_ids, v_guest_local_id) IS NOT NULL
       OR pg_catalog.array_position(v_guest_local_ids, v_guest_local_id) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    v_numeric := (v_guest_share ->> 'share_amount_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 0
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_share_amount_cents := v_numeric::integer;

    v_guest_share_local_ids := pg_catalog.array_append(
      v_guest_share_local_ids,
      v_guest_local_id
    );
    v_guest_share_total := v_guest_share_total + v_share_amount_cents;
    IF v_guest_share_total > v_total_amount
       OR v_user_share_total + v_guest_share_total > v_total_amount THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
  END LOOP;

  FOR v_payer IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payers)
  LOOP
    IF pg_catalog.jsonb_typeof(v_payer) <> 'object'
       OR NOT (v_payer ?& ARRAY['user_id', 'amount_cents'])
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_object_keys(v_payer) AS keys(key_name)
          WHERE keys.key_name NOT IN ('user_id', 'amount_cents')
       )
       OR pg_catalog.jsonb_typeof(v_payer -> 'user_id') <> 'string'
       OR pg_catalog.jsonb_typeof(v_payer -> 'amount_cents') <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    BEGIN
      v_user_id := (v_payer ->> 'user_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END;

    IF pg_catalog.array_position(v_payer_user_ids, v_user_id) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
    END IF;

    IF pg_catalog.array_position(v_user_share_ids, v_user_id) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'payer_not_participant';
    END IF;

    v_numeric := (v_payer ->> 'amount_cents')::numeric;
    IF v_numeric <> pg_catalog.trunc(v_numeric)
       OR v_numeric < 1
       OR v_numeric > public.expense_money_max_cents() THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
    v_payer_amount_cents := v_numeric::integer;

    v_payer_user_ids := pg_catalog.array_append(v_payer_user_ids, v_user_id);
    v_payer_total := v_payer_total + v_payer_amount_cents;
    IF v_payer_total > v_total_amount THEN
      RAISE EXCEPTION USING ERRCODE = 'PST03', MESSAGE = 'invalid_amount';
    END IF;
  END LOOP;

  IF NOT v_is_new THEN
    FOR v_protected_claimant_id IN
      SELECT DISTINCT g.claimed_by
        FROM public.expense_guests g
       WHERE g.expense_id = v_expense.id
         AND g.claimed_by IS NOT NULL
    LOOP
      IF pg_catalog.array_position(v_user_share_ids, v_protected_claimant_id) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'PST04', MESSAGE = 'claimed_guest_not_participant';
      END IF;
    END LOOP;
  END IF;

  IF v_is_new THEN
    v_expense_id := gen_random_uuid();
    v_token := graph_internal.open_named_token(v_expense_id, 'new', 0, v_group.id);

    INSERT INTO public.expenses (
      id,
      group_id,
      creator_id,
      title,
      merchant_name,
      expense_type,
      total_amount,
      service_fee_percent,
      fixed_fees,
      status,
      graph_revision
    ) VALUES (
      v_expense_id,
      v_group.id,
      v_caller,
      v_title,
      v_merchant_name,
      v_expense_type::public.expense_type,
      v_total_amount,
      v_service_fee_percent,
      v_fixed_fees,
      'draft',
      v_next_revision
    );
  ELSE
    v_token := graph_internal.open_named_token(v_expense.id, 'existing_save', v_expense.graph_revision, v_group.id);

    UPDATE public.expenses
       SET title = v_title,
           merchant_name = v_merchant_name,
           expense_type = v_expense_type::public.expense_type,
           total_amount = v_total_amount,
           service_fee_percent = v_service_fee_percent,
           fixed_fees = v_fixed_fees,
           graph_revision = v_next_revision
     WHERE id = v_expense.id;

    v_expense_id := v_expense.id;
  END IF;

  DELETE FROM public.expense_guest_shares gs
   WHERE gs.expense_id = v_expense_id
     AND EXISTS (
       SELECT 1
         FROM public.expense_guests g
        WHERE g.id = gs.guest_id
          AND g.claimed_by IS NULL
     );
  DELETE FROM public.expense_payers WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_shares WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_items WHERE expense_id = v_expense_id;
  DELETE FROM public.expense_guests
   WHERE expense_id = v_expense_id
     AND claimed_by IS NULL;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.expense_items (
      expense_id,
      description,
      quantity,
      unit_price_cents,
      total_price_cents
    ) VALUES (
      v_expense_id,
      v_item ->> 'description',
      ((v_item ->> 'quantity')::numeric)::integer,
      ((v_item ->> 'unit_price_cents')::numeric)::integer,
      ((v_item ->> 'total_price_cents')::numeric)::integer
    );
  END LOOP;

  FOR v_share IN SELECT value FROM pg_catalog.jsonb_array_elements(p_shares)
  LOOP
    INSERT INTO public.expense_shares (
      expense_id,
      user_id,
      share_amount_cents
    ) VALUES (
      v_expense_id,
      (v_share ->> 'user_id')::uuid,
      ((v_share ->> 'share_amount_cents')::numeric)::integer
    );
  END LOOP;

  FOR v_guest IN SELECT value FROM pg_catalog.jsonb_array_elements(p_guests)
  LOOP
    INSERT INTO public.expense_guests (expense_id, display_name)
    VALUES (v_expense_id, v_guest ->> 'display_name')
    RETURNING id INTO v_guest_id;

    SELECT gs.value
      INTO v_guest_share
      FROM pg_catalog.jsonb_array_elements(p_guest_shares) AS gs(value)
     WHERE gs.value ->> 'local_id' = v_guest ->> 'local_id';

    IF FOUND THEN
      INSERT INTO public.expense_guest_shares (
        expense_id,
        guest_id,
        share_amount_cents
      ) VALUES (
        v_expense_id,
        v_guest_id,
        ((v_guest_share ->> 'share_amount_cents')::numeric)::integer
      );
    END IF;
  END LOOP;

  FOR v_payer IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payers)
  LOOP
    INSERT INTO public.expense_payers (
      expense_id,
      user_id,
      amount_cents
    ) VALUES (
      v_expense_id,
      (v_payer ->> 'user_id')::uuid,
      ((v_payer ->> 'amount_cents')::numeric)::integer
    );
  END LOOP;

  PERFORM graph_internal.close_token(v_token);

  v_result := pg_catalog.jsonb_build_object(
    'id', v_expense_id,
    'graph_revision', v_next_revision
  );

  INSERT INTO public.expense_graph_save_operations (
    operation_id,
    caller_id,
    group_id,
    canonical_request,
    outcome,
    expense_id,
    graph_revision,
    result,
    result_created_at
  ) VALUES (
    p_save_operation_id,
    v_caller,
    v_group.id,
    v_canonical_request,
    'committed',
    v_expense_id,
    v_next_revision,
    v_result,
    pg_catalog.statement_timestamp()
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.save_expense_draft_graph(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, uuid
) IS
  'Issue #477 prerequisite graph save: revisioned CAS and durable operation replay against the current schema, now under the expense-graph mutation-token guard. Nonempty participant_order is intentionally rejected until draft map persistence lands.';

REVOKE ALL ON FUNCTION public.save_expense_draft_graph(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_expense_draft_graph(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, uuid
) TO authenticated;

-- ============================================================
-- 14. leave_group / remove_group_member: each issues a raw
--     DELETE FROM public.expenses WHERE id = ANY(v_draft_ids) for the
--     departing/removed member's own draft expenses, entirely outside
--     any named-writer RPC. Wrap it with begin_expense_graph_direct_mutation
--     so the guard's DELETE rule is satisfied; every other statement in
--     both functions is unchanged from 20260729100000's definition.
-- ============================================================

CREATE OR REPLACE FUNCTION public.leave_group(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller         uuid := auth.uid();
  v_group_creator  uuid;
  v_member_status  text;
  v_draft_ids      uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  IF v_caller = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: group creator cannot leave the group';
  END IF;

  SELECT status INTO v_member_status
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_member: you are not a member of this group';
  END IF;

  IF v_member_status != 'accepted' THEN
    RAISE EXCEPTION 'not_accepted: only accepted members can leave a group (use decline for invitations)';
  END IF;

  IF public.has_outstanding_balance(p_group_id, v_caller) THEN
    RAISE EXCEPTION 'has_outstanding_balance: you have unsettled debts in this group';
  END IF;

  DELETE FROM public.settlements
  WHERE group_id    = p_group_id
    AND status      = 'pending'
    AND (from_user_id = v_caller OR to_user_id = v_caller);

  DELETE FROM public.balances
  WHERE group_id = p_group_id
    AND (user_a = v_caller OR user_b = v_caller)
    AND amount_cents = 0;

  SELECT array_agg(id) INTO v_draft_ids
    FROM (
      SELECT id
        FROM public.expenses
       WHERE group_id = p_group_id AND creator_id = v_caller AND status = 'draft'
       ORDER BY id
       FOR UPDATE
    ) locked_drafts;

  IF v_draft_ids IS NOT NULL THEN
    PERFORM public.begin_expense_graph_direct_mutation(v_draft_ids);
    DELETE FROM public.expenses WHERE id = ANY(v_draft_ids);
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_caller;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_member(
  p_group_id uuid,
  p_user_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller         uuid := auth.uid();
  v_group_creator  uuid;
  v_draft_ids      uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT creator_id INTO v_group_creator
  FROM public.groups
  WHERE id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  IF v_caller != v_group_creator THEN
    RAISE EXCEPTION 'permission_denied: only the group creator can remove members';
  END IF;

  IF p_user_id = v_group_creator THEN
    RAISE EXCEPTION 'invalid_operation: cannot remove the group creator';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'member_not_found: user is not a member of this group';
  END IF;

  IF public.has_outstanding_balance(p_group_id, p_user_id) THEN
    RAISE EXCEPTION 'has_outstanding_balance: member has unsettled debts in this group';
  END IF;

  SELECT array_agg(id) INTO v_draft_ids
    FROM (
      SELECT id
        FROM public.expenses
       WHERE group_id = p_group_id AND creator_id = p_user_id AND status = 'draft'
       ORDER BY id
       FOR UPDATE
    ) locked_drafts;

  IF v_draft_ids IS NOT NULL THEN
    PERFORM public.begin_expense_graph_direct_mutation(v_draft_ids);
    DELETE FROM public.expenses WHERE id = ANY(v_draft_ids);
  END IF;

  DELETE FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

