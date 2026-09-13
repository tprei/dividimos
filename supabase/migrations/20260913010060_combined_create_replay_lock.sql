-- Concurrent create_expense_with_group retries with the same client-supplied
-- identity both missed the existing-expense pre-check, each created its own
-- group, and the loser then replayed the winner's expense against its own
-- doomed group: create_expense's cross-group replay guard raised
-- invalid_argument and the loser's whole transaction rolled back, so a retry
-- that must be idempotent failed nondeterministically. Serialize retries on
-- the client identity before the pre-check; the second racer now observes
-- the winner's expense and replays it. Plain create_expense keeps rejecting
-- cross-group client_id reuse.
CREATE OR REPLACE FUNCTION public.create_expense_with_group(
  p_client_id uuid, p_group_name text, p_member_ids uuid[],
  p_occurred_on date, p_title text, p_merchant_name text,
  p_expense_type expense_type, p_total_cents integer,
  p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb, p_chave_acesso text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_existing_id uuid;
  v_existing_group_id uuid;
  v_existing_status public.expense_status;
  v_existing_version_no integer;
  v_existing_ledger_version bigint;
  v_group jsonb;
  v_group_id uuid;
BEGIN
  v_actor := current_user_id();

  -- Serialize retries on the client-supplied identity before looking for an
  -- existing expense. Without this lock, two concurrent retries both miss
  -- the pre-check, both create their own group, and the loser then replays
  -- the winner's expense against its own doomed group, which rolls back
  -- with invalid_argument instead of the replay ack the caller deserves.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('create_expense_with_group:' || p_client_id::text, 0)
  );

  SELECT id, group_id, status, current_version_no
    INTO v_existing_id, v_existing_group_id, v_existing_status, v_existing_version_no
  FROM expenses WHERE client_id = p_client_id;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status = 'deleted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
    END IF;
    -- A replay must belong to the caller; another member's expense is not
    -- theirs to read back.
    PERFORM assert_member(v_existing_group_id, v_actor);
    SELECT ledger_version INTO v_existing_ledger_version
    FROM groups WHERE id = v_existing_group_id;
    RETURN jsonb_build_object(
      'expenseId', v_existing_id,
      'groupId', v_existing_group_id,
      'versionNo', v_existing_version_no,
      'ledgerVersion', v_existing_ledger_version,
      'eventId', NULL
    );
  END IF;

  v_group := create_group(p_group_name, p_member_ids);
  v_group_id := (v_group->>'groupId')::uuid;

  RETURN create_expense(
    p_client_id, v_group_id, p_occurred_on, p_title, p_merchant_name,
    p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents,
    p_payload, p_chave_acesso
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense_with_group(uuid, text, uuid[], date, text, text, expense_type, integer, integer, integer, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_expense_with_group(uuid, text, uuid[], date, text, text, expense_type, integer, integer, integer, jsonb, text) TO authenticated;
