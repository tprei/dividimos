-- Issue #581 (cutover): install the creator-issued guest-claim credential
-- RPCs and switch claim_guest_spot to the opaque text token, dropping the
-- legacy uuid overload in the same atomic change.
--
-- PostgREST resolves RPC overloads by argument shape; claim_guest_spot(uuid)
-- and claim_guest_spot(text) coexisting makes a JSON string argument
-- ambiguous. The drop and the text install are therefore one migration.
--
-- This migration is the sole owner that exposes the text credential. It
-- leaves the legacy expense_guests.claim_token column in place (the final
-- drop-legacy migration removes it); only the uuid RPC path is retired.

-- ============================================================
-- 1. issue_guest_claim_token: creator-only, explicit issue/rotate.
--    Non-revealing on replay; compare-and-swap rotation.
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_guest_claim_token(
  p_guest_id            uuid,
  p_rotate              boolean,
  p_expected_generation integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id    uuid := auth.uid();
  v_group_id     uuid;
  v_group        RECORD;
  v_expense      RECORD;
  v_guest        RECORD;
  v_cred         RECORD;
  v_token        text;
  v_digest       bytea;
  v_generation   integer;
  v_attempts     integer := 0;
  v_constraint   text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST01', MESSAGE = 'not_authenticated';
  END IF;

  -- Mode/argument validation (before any discovery).
  IF p_guest_id IS NULL
     OR p_rotate IS NULL
     OR (p_rotate = false AND p_expected_generation IS NOT NULL)
     OR (p_rotate = true AND (p_expected_generation IS NULL OR p_expected_generation <= 0)) THEN
    RAISE EXCEPTION USING ERRCODE = 'PST02', MESSAGE = 'invalid_request';
  END IF;

  -- Non-locking discovery of the candidate group.
  SELECT e.group_id
    INTO v_group_id
    FROM public.expense_guests eg
    JOIN public.expenses e ON e.id = eg.expense_id
   WHERE eg.id = p_guest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'lifecycle_conflict';
  END IF;

  -- Group lifecycle lock first.
  SELECT g.* INTO v_group
    FROM public.groups g
   WHERE g.id = v_group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'lifecycle_conflict';
  END IF;

  -- Expense lock + creator/authority checks.
  SELECT e.* INTO v_expense
    FROM public.expenses e
   WHERE e.id = (SELECT expense_id FROM public.expense_guests WHERE id = p_guest_id)
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'lifecycle_conflict';
  END IF;

  IF v_expense.group_id IS DISTINCT FROM v_group.id
     OR v_expense.creator_id IS DISTINCT FROM v_caller_id
     OR v_expense.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  -- Current group authority: locked group creator OR accepted member. A
  -- regular-group creator intentionally needs no membership row.
  IF v_group.creator_id IS DISTINCT FROM v_caller_id
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = v_group.id
          AND gm.user_id = v_caller_id
          AND gm.status = 'accepted'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PST05', MESSAGE = 'permission_denied';
  END IF;

  -- #472 shape + actor authorization under the group lock.
  PERFORM public.assert_dm_group_shape(v_group.id, false);
  PERFORM public.assert_dm_actor(v_group.id, v_caller_id);

  -- Guest lock + unclaimed check.
  SELECT eg.* INTO v_guest
    FROM public.expense_guests eg
   WHERE eg.id = p_guest_id
     FOR UPDATE;

  IF NOT FOUND OR v_guest.expense_id IS DISTINCT FROM v_expense.id THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'lifecycle_conflict';
  END IF;

  IF v_guest.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'lifecycle_conflict';
  END IF;

  -- Credential lock (may be absent on first issue).
  SELECT * INTO v_cred
    FROM guest_credentials.expense_guest_claim_tokens
   WHERE guest_id = p_guest_id
     FOR UPDATE;

  IF p_rotate = false AND v_cred IS NOT NULL THEN
    -- Replay: never reveal or change the existing secret.
    RETURN jsonb_build_object(
      'outcome', 'exists',
      'generation', v_cred.token_generation
    );
  END IF;

  IF p_rotate = true THEN
    IF v_cred IS NULL
       OR v_cred.token_generation IS DISTINCT FROM p_expected_generation THEN
      RAISE EXCEPTION USING ERRCODE = 'PST08', MESSAGE = 'lifecycle_conflict';
    END IF;
    IF v_cred.token_generation = 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'credential_state_corrupt';
    END IF;
    v_generation := v_cred.token_generation + 1;
  ELSE
    v_generation := 1;
  END IF;

  -- Generate + hash, with a bounded retry on a digest collision (the only
  -- unique constraint we catch). A collision leaks no detail: we convert it
  -- to a detail-free PST07 on exhaustion and re-raise every other failure.
  LOOP
    v_attempts := v_attempts + 1;
    v_token := guest_credentials.generate_guest_claim_token();
    v_digest := guest_credentials.guest_claim_token_digest(v_token);

    -- On a rotate, regenerating the *current* digest would be a no-op:
    -- try again rather than persisting it. (First issue: v_cred IS NULL,
    -- so this never fires and we proceed to the INSERT below.)
    IF v_cred IS NOT NULL AND v_digest IS NOT DISTINCT FROM v_cred.token_digest THEN
      IF v_attempts >= 5 THEN
        RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'credential_state_corrupt';
      END IF;
      -- retry: regenerate a fresh token
      CONTINUE;
    END IF;

    BEGIN
      IF v_cred IS NULL THEN
        INSERT INTO guest_credentials.expense_guest_claim_tokens
          (guest_id, token_version, token_generation, token_digest, issued_at)
        VALUES (p_guest_id, 1, v_generation, v_digest, now());
      ELSE
        UPDATE guest_credentials.expense_guest_claim_tokens
           SET token_digest = v_digest,
               token_generation = v_generation,
               issued_at = now()
         WHERE guest_id = p_guest_id;
      END IF;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint <> 'expense_guest_claim_tokens_digest_uq' THEN
          RAISE;
        END IF;
        IF v_attempts >= 5 THEN
          RAISE EXCEPTION USING ERRCODE = 'PST07', MESSAGE = 'credential_state_corrupt';
        END IF;
        -- retry: regenerate a fresh token
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'outcome', 'issued',
    'token', v_token,
    'rotated', p_rotate,
    'generation', v_generation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_guest_claim_token(uuid, boolean, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_guest_claim_token(uuid, boolean, integer)
  TO authenticated;

-- ============================================================
-- 2. resolve_guest_claim_token: service-only, returns only the three IDs.
--    Malformed and unknown inputs are indistinguishable (both empty).
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_guest_claim_token(p_claim_token text)
RETURNS TABLE (
  guest_id   uuid,
  expense_id uuid,
  group_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    RETURN QUERY
    SELECT l.guest_id, l.expense_id, l.group_id
      FROM guest_credentials.lookup_guest_claim_token(p_claim_token) l;
  EXCEPTION
    WHEN sqlstate 'PST02' THEN
      -- Malformed token: indistinguishable from a well-formed miss.
      RETURN;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_guest_claim_token(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_guest_claim_token(text)
  TO service_role;

-- ============================================================
-- 3. claim_guest_spot(text): the text-credential claim, with #472 DM
--    authorization and #468/#477/#495 financial semantics carried over
--    verbatim from claim_guest_spot(uuid) (PR 1's DM-guarded body). Only
--    the credential lookup, the credential lock/recheck, and the stable
--    error codes change.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_claim_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id              uuid := auth.uid();
  v_guest_ref              RECORD;
  v_group                  RECORD;
  v_expense                RECORD;
  v_guest                  RECORD;
  v_guest_share            RECORD;
  v_existing               uuid;
  v_existing_share_amount  integer;
  v_guest_entity_idx       integer;
  v_pending_sum            integer := 0;
  r_edge                   RECORD;
  v_user_a                 uuid;
  v_user_b                 uuid;
  v_delta                  integer;
  v_token                  uuid;
  v_cred_digest            bytea;
  v_cred_gen               integer;
  v_maintenance             boolean;
BEGIN
  -- #477/#495: "Run #477's financial compatibility guard as the first
  -- body action and require authentication." Shared lock first: see
  -- activate_saved_expense's identical comment (20260731000000).
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(477000001::bigint);

  SELECT maintenance INTO v_maintenance
    FROM financial_internal.financial_compatibility_state
   WHERE id = true;

  IF v_maintenance THEN
    RAISE EXCEPTION 'financial_maintenance' USING ERRCODE = 'PST09';
  END IF;

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PST01';
  END IF;

  -- Sole credential lookup. A malformed token raises PST02 from the helper
  -- (unhandled here -> caller); a well-formed miss returns no rows -> PST05.
  SELECT * INTO v_guest_ref
    FROM guest_credentials.lookup_guest_claim_token(p_claim_token);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'PST05';
  END IF;

  SELECT g.id
    INTO v_group
    FROM public.groups g
   WHERE g.id = v_guest_ref.group_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  -- #472: canonical DM authorization. Runs under the group lifecycle
  -- lock and before any guest/claim-state read or membership, share,
  -- allocation or balance write. Mirrors join_group_via_link's guard.
  PERFORM public.assert_dm_group_shape(v_group.id, false);
  PERFORM public.assert_dm_actor(v_group.id, v_caller_id);

  SELECT e.*
    INTO v_expense
    FROM public.expenses e
   WHERE e.id = v_guest_ref.expense_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense_not_found: associated expense does not exist'
      USING ERRCODE = 'PST08';
  END IF;

  IF v_expense.group_id IS DISTINCT FROM v_group.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  SELECT eg.*
    INTO v_guest
    FROM public.expense_guests eg
   WHERE eg.id = v_guest_ref.guest_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'PST05';
  END IF;

  IF v_guest.expense_id IS DISTINCT FROM v_expense.id THEN
    RAISE EXCEPTION 'lifecycle_conflict' USING ERRCODE = 'PST08';
  END IF;

  -- Recheck the credential under its own lock: a rotation winner makes this
  -- stale claim invalid (PST05) before any state mutation.
  SELECT token_digest, token_generation
    INTO v_cred_digest, v_cred_gen
    FROM guest_credentials.expense_guest_claim_tokens
   WHERE guest_id = v_guest.id
     FOR UPDATE;

  IF NOT FOUND
     OR v_cred_digest IS DISTINCT FROM v_guest_ref.token_digest
     OR v_cred_gen IS DISTINCT FROM v_guest_ref.token_generation THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'PST05';
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

  -- Check for existing user share.
  SELECT id, share_amount_cents
    INTO v_existing, v_existing_share_amount
    FROM public.expense_shares
   WHERE expense_id = v_guest.expense_id
     AND user_id = v_caller_id;

  IF FOUND THEN
    -- #495: zero-share payer can claim by updating the zero share to
    -- the guest's share amount, instead of raising duplicate_participant.
    IF v_existing_share_amount = 0 AND EXISTS (
      SELECT 1 FROM public.expense_payers ep
       WHERE ep.expense_id = v_guest.expense_id
         AND ep.user_id = v_caller_id
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'duplicate_participant: you already have a share on this expense'
        USING ERRCODE = 'PST04';
    END IF;
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
    IF v_existing IS NOT NULL THEN
      UPDATE public.expense_shares
         SET share_amount_cents = v_guest_share.share_amount_cents
       WHERE expense_id = v_guest.expense_id
         AND user_id = v_caller_id;
    ELSE
      INSERT INTO public.expense_shares (expense_id, user_id, share_amount_cents)
      VALUES (v_guest.expense_id, v_caller_id, v_guest_share.share_amount_cents);
    END IF;

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
     SET updated_at = now(),
         graph_revision = graph_revision + 1
   WHERE id = v_guest.expense_id;

  PERFORM graph_internal.close_token(v_token);

  RETURN jsonb_build_object(
    'guest_id', v_guest.id,
    'expense_id', v_guest.expense_id,
    'already_claimed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_spot(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_guest_spot(text)
  TO authenticated;

-- Drop the legacy uuid overload. No IF EXISTS: a missing function means the
-- catalog is not what this migration assumes.
DROP FUNCTION public.claim_guest_spot(uuid);

COMMENT ON FUNCTION public.claim_guest_spot(text) IS
  'Issue #581: claim a guest spot by opaque text credential (gst1_...). '
  'Resolves the token through guest_credentials.lookup_guest_claim_token, '
  'rechecks it under its own lock (a rotation winner invalidates a stale '
  'claim with PST05), then applies #468/#477/#495 financial semantics and '
  '#472 DM authorization.';
