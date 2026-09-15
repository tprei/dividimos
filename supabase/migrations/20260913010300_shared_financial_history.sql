-- Shared-financial-history latch (P6).
--
-- Defect: delete_group counted CURRENT members, so a creator could destroy a
-- group's financial history once every witness had departed. The latch records,
-- once, the first transaction in which a financial fact can belong to or
-- become visible to more than one user, and delete_group refuses to run while
-- it is set. leave_group, remove_member, and decline_invitation never clear it.
--
-- Column:
--   public.groups.financial_history_shared_at timestamptz NULL
--
-- RPC changes:
--   create_expense / edit_expense / restore_expense: latch when the active
--     expense meets more than one accepted member or the effective payload
--     names another invited/accepted user
--   accept_invitation / join_via_link: latch when the group already holds facts
--   claim_guest: latch on granting membership for an existing expense
--   record_settlement: latch on any confirmed settlement
--   delete_group: deny with group_has_history while the latch is set;
--     outstanding_balance keeps its earlier precedence
--
-- Backfill only from evidence of shared financial history: facts (an expense
-- or settlement) plus a surviving noncreator membership, a prior
-- member_joined/member_left/member_removed event, or a noncreator financial
-- participant in the available current facts. An invitation that ended before
-- any financial sharing must not become a permanent deletion block.

set check_function_bodies = off;

ALTER TABLE public.groups ADD COLUMN financial_history_shared_at timestamptz;

CREATE OR REPLACE FUNCTION public.create_expense(
  p_client_id uuid, p_group_id uuid, p_occurred_on date,
  p_title text, p_merchant_name text, p_expense_type expense_type,
  p_total_cents integer, p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb, p_chave_acesso text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_title text;
  v_payload jsonb;
  v_expense_id uuid;
  v_existing_id uuid;
  v_existing_group_id uuid;
  v_existing_status public.expense_status;
  v_existing_version_no integer;
  v_existing_ledger_version bigint;
  v_ledger_version bigint;
  v_event_id bigint;
  v_constraint text;
BEGIN
  v_actor := current_user_id();


  PERFORM lock_receipt_key(v_actor, p_chave_acesso);
  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT id, group_id, status, current_version_no
    INTO v_existing_id, v_existing_group_id, v_existing_status, v_existing_version_no
  FROM expenses WHERE client_id = p_client_id;
  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status = 'deleted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
    END IF;
    IF v_existing_group_id <> p_group_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    SELECT ledger_version INTO v_existing_ledger_version FROM groups WHERE id = p_group_id;
    RETURN jsonb_build_object(
      'expenseId', v_existing_id,
      'groupId', p_group_id,
      'versionNo', v_existing_version_no,
      'ledgerVersion', v_existing_ledger_version,
      'eventId', NULL
    );
  END IF;
  IF p_chave_acesso IS NOT NULL AND p_chave_acesso !~ '^[0-9]{44}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_chave_acesso IS NOT NULL AND EXISTS (
    SELECT 1
    FROM expenses
    WHERE creator_id = v_actor
      AND chave_acesso = p_chave_acesso
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
  END IF;

  v_title := btrim(p_title);
  IF v_title IS NULL OR length(v_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_merchant_name IS NOT NULL AND length(btrim(p_merchant_name)) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_occurred_on IS NULL OR p_expense_type IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_total_cents IS NULL OR p_total_cents NOT BETWEEN 1 AND 99999999
     OR p_service_fee_bps IS NULL OR p_service_fee_bps NOT BETWEEN 0 AND 10000
     OR p_fixed_fee_cents IS NULL OR p_fixed_fee_cents NOT BETWEEN 0 AND 99999999
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_payload := validate_expense_payload(p_payload, p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents);

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_payload->'participants') AS pp(p)
    WHERE pp.p->>'kind' = 'user' AND (pp.p->>'userId')::uuid = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'creator_not_participant';
  END IF;

  BEGIN
    INSERT INTO expenses (client_id, group_id, creator_id, occurred_on, chave_acesso)
    VALUES (p_client_id, p_group_id, v_actor, p_occurred_on, p_chave_acesso)
    RETURNING id INTO v_expense_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'expenses_creator_chave_active_idx' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END;

  v_payload := materialize_participants(v_expense_id, v_actor, v_payload);

  -- Shared-history latch: the new expense becomes visible to more than one
  -- user when a second accepted member can read it or the payload names
  -- another invited/accepted user.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = p_group_id
    AND financial_history_shared_at IS NULL
    AND (
      (SELECT count(*) FROM public.group_members
       WHERE group_id = p_group_id AND status = 'accepted') > 1
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_payload->'participants') AS pp(p)
        WHERE pp.p->>'kind' = 'user'
          AND (pp.p->>'userId')::uuid IS DISTINCT FROM v_actor
          AND EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = p_group_id
              AND gm.user_id = (pp.p->>'userId')::uuid
              AND gm.status IN ('invited', 'accepted')
          )
      )
    );

  INSERT INTO expense_versions (
    expense_id, version_no, author_id, title, merchant_name, expense_type,
    total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
  ) VALUES (
    v_expense_id, 1, v_actor, v_title, btrim(p_merchant_name), p_expense_type,
    p_total_cents, p_service_fee_bps, p_fixed_fee_cents, v_payload, NULL
  );

  v_ledger_version := recompute_group_balances(p_group_id);
  v_event_id := emit_event(
    p_group_id, 'expense_created', v_actor, v_expense_id,
    NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', p_total_cents)
  );
  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_expense_id,
    'groupId', p_group_id,
    'versionNo', 1,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, uuid, date, text, text, expense_type, integer, integer, integer, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_expense(
  p_expense_id uuid, p_expected_version_no integer,
  p_occurred_on date, p_title text, p_merchant_name text, p_expense_type expense_type,
  p_total_cents integer, p_service_fee_bps integer, p_fixed_fee_cents integer,
  p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_creator_id uuid;
  v_status public.expense_status;
  v_current_version_no integer;
  v_new_version_no integer;
  v_title text;
  v_payload jsonb;
  v_change_summary jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  SELECT group_id INTO v_group_id FROM expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;

  PERFORM lock_group(v_group_id);
  PERFORM assert_member(v_group_id, v_actor);

  -- Re-read under the lock: an unlocked read lets two racing edits both pass
  -- the version check and collide on expense_versions_pkey.
  SELECT status, current_version_no, creator_id
    INTO v_status, v_current_version_no, v_creator_id
  FROM expenses WHERE id = p_expense_id;

  IF v_creator_id IS DISTINCT FROM v_actor AND NOT EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = p_expense_id AND kind = 'user' AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;
  IF p_expected_version_no IS NULL OR v_current_version_no <> p_expected_version_no THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  v_title := btrim(p_title);
  IF v_title IS NULL OR length(v_title) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_merchant_name IS NOT NULL AND length(btrim(p_merchant_name)) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_occurred_on IS NULL OR p_expense_type IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_total_cents IS NULL OR p_total_cents NOT BETWEEN 1 AND 99999999
     OR p_service_fee_bps IS NULL OR p_service_fee_bps NOT BETWEEN 0 AND 10000
     OR p_fixed_fee_cents IS NULL OR p_fixed_fee_cents NOT BETWEEN 0 AND 99999999
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  v_payload := validate_expense_payload(p_payload, p_expense_type, p_total_cents, p_service_fee_bps, p_fixed_fee_cents);

  v_new_version_no := v_current_version_no + 1;
  v_payload := materialize_participants(p_expense_id, v_actor, v_payload);

  -- Shared-history latch: the new version becomes visible to more than one
  -- user when a second accepted member can read it or the payload names
  -- another invited/accepted user.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_group_id
    AND financial_history_shared_at IS NULL
    AND (
      (SELECT count(*) FROM public.group_members
       WHERE group_id = v_group_id AND status = 'accepted') > 1
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_payload->'participants') AS pp(p)
        WHERE pp.p->>'kind' = 'user'
          AND (pp.p->>'userId')::uuid IS DISTINCT FROM v_actor
          AND EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = v_group_id
              AND gm.user_id = (pp.p->>'userId')::uuid
              AND gm.status IN ('invited', 'accepted')
          )
      )
    );

  INSERT INTO expense_versions (
    expense_id, version_no, author_id, title, merchant_name, expense_type,
    total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
  ) VALUES (
    p_expense_id, v_new_version_no, v_actor, v_title, btrim(p_merchant_name), p_expense_type,
    p_total_cents, p_service_fee_bps, p_fixed_fee_cents, v_payload, NULL
  );

  v_change_summary := expense_change_summary(p_expense_id, v_current_version_no, v_new_version_no);
  UPDATE expense_versions SET change_summary = v_change_summary
  WHERE expense_id = p_expense_id AND version_no = v_new_version_no;

  UPDATE expenses SET occurred_on = p_occurred_on, current_version_no = v_new_version_no
  WHERE id = p_expense_id;

  v_ledger_version := recompute_group_balances(v_group_id);
  v_event_id := emit_event(v_group_id, 'expense_edited', v_actor, p_expense_id, NULL, NULL, v_change_summary);
  PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'groupId', v_group_id,
    'versionNo', v_new_version_no,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.edit_expense(uuid, integer, date, text, text, expense_type, integer, integer, integer, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_expense(p_expense_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_creator_id uuid;
  v_chave_acesso text;
  v_status public.expense_status;
  v_version_no integer;
  v_title text;
  v_total_cents integer;
  v_payload jsonb;
  v_materialized jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
  v_constraint text;
BEGIN
  v_actor := current_user_id();

  SELECT group_id, creator_id, chave_acesso
    INTO v_group_id, v_creator_id, v_chave_acesso
  FROM expenses
  WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_found';
  END IF;

  PERFORM lock_receipt_key(v_creator_id, v_chave_acesso);
  PERFORM lock_group(v_group_id);
  PERFORM assert_member(v_group_id, v_actor);

  SELECT status, current_version_no, creator_id, chave_acesso
    INTO v_status, v_version_no, v_creator_id, v_chave_acesso
  FROM expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  SELECT payload, title, total_cents INTO v_payload, v_title, v_total_cents
  FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_version_no;

  IF v_creator_id IS DISTINCT FROM v_actor AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_payload->'participants', '[]'::jsonb)) AS pp(p)
    WHERE pp.p->>'kind' = 'user' AND pp.p ? 'userId'
      AND pp.p->>'userId' = v_actor::text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_expense_party';
  END IF;

  IF v_status = 'active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_not_deleted';
  END IF;

  IF v_chave_acesso IS NOT NULL AND EXISTS (
    SELECT 1
    FROM expenses
    WHERE creator_id = v_creator_id
      AND chave_acesso = v_chave_acesso
      AND status = 'active'
      AND id <> p_expense_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
  END IF;

  BEGIN
    UPDATE expenses SET status = 'active', deleted_at = NULL, deleted_by = NULL
    WHERE id = p_expense_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'expenses_creator_chave_active_idx' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_receipt';
      END IF;
      RAISE;
  END;

  v_materialized := materialize_participants(p_expense_id, v_actor, v_payload);
  IF v_materialized IS DISTINCT FROM v_payload THEN
    UPDATE expense_versions SET payload = v_materialized
    WHERE expense_id = p_expense_id AND version_no = v_version_no;
  END IF;

  -- Shared-history latch: the restored expense becomes visible to more than
  -- one user when a second accepted member can read it or the payload names
  -- another invited/accepted user.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_group_id
    AND financial_history_shared_at IS NULL
    AND (
      (SELECT count(*) FROM public.group_members
       WHERE group_id = v_group_id AND status = 'accepted') > 1
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_materialized->'participants') AS pp(p)
        WHERE pp.p->>'kind' = 'user'
          AND (pp.p->>'userId')::uuid IS DISTINCT FROM v_actor
          AND EXISTS (
            SELECT 1 FROM public.group_members gm
            WHERE gm.group_id = v_group_id
              AND gm.user_id = (pp.p->>'userId')::uuid
              AND gm.status IN ('invited', 'accepted')
          )
      )
    );

  v_ledger_version := recompute_group_balances(v_group_id);
  v_event_id := emit_event(
    v_group_id, 'expense_restored', v_actor, p_expense_id,
    NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', v_total_cents)
  );
  PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'groupId', v_group_id,
    'versionNo', v_version_no,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_expense(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_expense(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
  v_invited_by uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = p_group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  UPDATE group_members
  SET status = 'accepted', accepted_at = now()
  WHERE group_id = p_group_id AND user_id = v_actor;

  -- Shared-history latch: joining a group whose facts already exist makes
  -- them shared from this moment.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = p_group_id
    AND financial_history_shared_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.expenses WHERE group_id = p_group_id)
         OR EXISTS (SELECT 1 FROM public.settlements WHERE group_id = p_group_id));

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
  IF v_invited_by IS NOT NULL THEN
    PERFORM broadcast_user(v_invited_by, p_group_id);
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
  v_shared_at timestamptz;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  SELECT creator_id INTO v_creator_id FROM groups WHERE id = p_group_id;
  IF v_creator_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_creator';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  IF EXISTS (SELECT 1 FROM group_balances WHERE group_id = p_group_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
  END IF;

  -- The latch remembers that financial history was shared even when every
  -- witness has since departed; current membership alone cannot measure it.
  SELECT financial_history_shared_at INTO v_shared_at
  FROM groups WHERE id = p_group_id;
  IF v_shared_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_has_history';
  END IF;

  DELETE FROM groups WHERE id = p_group_id;

  RETURN jsonb_build_object('groupId', p_group_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_via_link(p_token text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_link RECORD;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  SELECT * INTO v_link FROM group_invite_links WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  PERFORM lock_group(v_link.group_id);

  SELECT * INTO v_link FROM group_invite_links WHERE id = v_link.id FOR UPDATE;

  IF NOT v_link.is_active
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
     OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  PERFORM assert_dm_pair_allowed(v_link.group_id, v_actor);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = v_link.group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status INTO v_status FROM group_members
  WHERE group_id = v_link.group_id AND user_id = v_actor
  FOR UPDATE;

  IF FOUND AND v_status = 'accepted' THEN
    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_link.group_id;
    RETURN jsonb_build_object(
      'groupId', v_link.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  UPDATE group_invite_links
  SET use_count = use_count + 1
  WHERE id = v_link.id;

  IF FOUND AND v_status = 'invited' THEN
    UPDATE group_members
    SET status = 'accepted', accepted_at = now()
    WHERE group_id = v_link.group_id AND user_id = v_actor;
  ELSE
    INSERT INTO group_members (group_id, user_id, status, accepted_at)
    VALUES (v_link.group_id, v_actor, 'accepted', now());
  END IF;

  -- Shared-history latch: joining a group whose facts already exist makes
  -- them shared from this moment.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_link.group_id
    AND financial_history_shared_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.expenses WHERE group_id = v_link.group_id)
         OR EXISTS (SELECT 1 FROM public.settlements WHERE group_id = v_link.group_id));

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_link.group_id;

  v_event_id := emit_event(
    v_link.group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(v_link.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', v_link.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_via_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_via_link(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_settlement(
  p_operation_id uuid,
  p_group_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount_cents integer,
  p_allow_overpay boolean DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_existing RECORD;
  v_settlement_id uuid;
  v_ledger_version bigint;
  v_from_net bigint;
  v_to_net bigint;
  v_event_id bigint;
  v_subject_user_id uuid;
BEGIN
  v_actor := current_user_id();

  IF p_operation_id IS NULL OR p_group_id IS NULL
     OR p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF v_actor <> p_from_user_id AND v_actor <> p_to_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_party';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT * INTO v_existing FROM settlements WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.from_user_id <> p_from_user_id OR v_existing.group_id <> p_group_id
       OR v_existing.to_user_id <> p_to_user_id OR v_existing.amount_cents <> p_amount_cents THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    IF v_existing.status = 'voided' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'settlement_voided';
    END IF;

    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;
    RETURN jsonb_build_object(
      'settlementId', v_existing.id,
      'groupId', v_existing.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  IF NOT is_member(p_group_id, CASE WHEN v_actor = p_from_user_id THEN p_to_user_id ELSE p_from_user_id END) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'counterparty_not_member';
  END IF;

  SELECT COALESCE((
    SELECT net_cents FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_from_user_id
  ), 0) INTO v_from_net;
  SELECT COALESCE((
    SELECT net_cents FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_to_user_id
  ), 0) INTO v_to_net;

  IF NOT COALESCE(p_allow_overpay, false) THEN
    IF v_from_net >= 0 OR p_amount_cents > -v_from_net
       OR v_to_net <= 0 OR p_amount_cents > v_to_net THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'amount_exceeds_debt';
    END IF;
  END IF;

  INSERT INTO settlements (operation_id, group_id, from_user_id, to_user_id, amount_cents, status, confirmed_at, created_by)
  VALUES (p_operation_id, p_group_id, p_from_user_id, p_to_user_id, p_amount_cents, 'confirmed', now(), v_actor)
  RETURNING id INTO v_settlement_id;

  -- Shared-history latch: any confirmed settlement is shared financial
  -- history by definition.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = p_group_id AND financial_history_shared_at IS NULL;

  v_ledger_version := recompute_group_balances(p_group_id);

  v_subject_user_id := CASE WHEN v_actor = p_from_user_id THEN p_to_user_id ELSE p_from_user_id END;

  v_event_id := emit_event(
    p_group_id,
    'settlement_recorded',
    v_actor,
    p_settlement_id => v_settlement_id,
    p_subject_user_id => v_subject_user_id,
    p_payload => jsonb_build_object('amountCents', p_amount_cents, 'fromUserId', p_from_user_id, 'toUserId', p_to_user_id)
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'settlementId', v_settlement_id,
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_settlement(uuid, uuid, uuid, uuid, integer, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.record_settlement(uuid, uuid, uuid, uuid, integer, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_guest(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_digest bytea;
  v_group_id uuid;
  v_guest_id uuid;
  v_rec RECORD;
  v_cred RECORD;
  v_payload jsonb;
  v_new_participants jsonb;
  v_new_payload jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'utf8'), 'sha256');

  SELECT ct.guest_id, e.group_id
  INTO v_guest_id, v_group_id
  FROM guest_credentials.claim_tokens ct
  JOIN guests g ON g.id = ct.guest_id
  JOIN expenses e ON e.id = g.expense_id
  WHERE ct.token_digest = v_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  PERFORM lock_group(v_group_id);

  SELECT g.id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = v_guest_id
  FOR UPDATE OF g, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT ct.guest_id, ct.expires_at
  INTO v_cred
  FROM guest_credentials.claim_tokens ct
  WHERE ct.guest_id = v_rec.id AND ct.token_digest = v_digest
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_cred.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_claimed';
  END IF;

  IF v_rec.expense_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  -- A guest dropped by a later edit keeps its row but no participant slot;
  -- redeeming that orphaned token would hand group membership to a stranger.
  IF NOT EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = v_rec.expense_id AND user_id = v_actor AND kind = 'user'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_participant';
  END IF;

  PERFORM assert_dm_pair_allowed(v_rec.group_id, v_actor);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = v_rec.group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  UPDATE guests
  SET claimed_by = v_actor,
      claimed_at = now()
  WHERE id = v_rec.id;

  UPDATE expense_participants
  SET kind = 'user',
      user_id = v_actor,
      guest_id = NULL
  WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id;

  SELECT payload INTO v_payload
  FROM expense_versions
  WHERE expense_id = v_rec.expense_id AND version_no = v_rec.current_version_no;

  SELECT jsonb_agg(
    CASE
      WHEN p->>'kind' = 'guest' AND p->>'guestId' = v_rec.id::text
      THEN jsonb_build_object('kind', 'user', 'userId', v_actor)
      ELSE p
    END
    ORDER BY ord
  )
  INTO v_new_participants
  FROM jsonb_array_elements(v_payload->'participants') WITH ORDINALITY AS t(p, ord);

  v_new_payload := jsonb_set(v_payload, '{participants}', v_new_participants);

  UPDATE expense_versions
  SET payload = v_new_payload
  WHERE expense_id = v_rec.expense_id AND version_no = v_rec.current_version_no;

  INSERT INTO group_members (group_id, user_id, status, accepted_at)
  VALUES (v_rec.group_id, v_actor, 'accepted', now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = 'accepted', accepted_at = COALESCE(group_members.accepted_at, now());

  -- Shared-history latch: the claim just granted membership for an existing
  -- expense to a new user, so the expense's facts are shared from now on.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_rec.group_id AND financial_history_shared_at IS NULL;

  v_ledger_version := recompute_group_balances(v_rec.group_id);

  v_event_id := emit_event(
    p_group_id => v_rec.group_id,
    p_kind => 'guest_claimed',
    p_actor => v_actor,
    p_expense_id => v_rec.expense_id,
    p_settlement_id => NULL,
    p_subject_user_id => v_actor,
    p_payload => jsonb_build_object('displayName', v_rec.display_name)
  );

  PERFORM broadcast_group(v_rec.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_rec.expense_id,
    'groupId', v_rec.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest(text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_guest(text) TO authenticated;

-- Backfill from evidence only: a group keeps its history (and its deletion
-- block) when facts exist beside a surviving noncreator membership, a prior
-- member_joined/member_left/member_removed event, or a noncreator financial
-- participant in the available current facts. An invitation that ended before
-- any financial sharing leaves the group deletable.
UPDATE public.groups g
SET financial_history_shared_at = COALESCE(
      (
        SELECT MIN(e.created_at) FROM public.expenses e WHERE e.group_id = g.id
      ),
      (
        SELECT MIN(s.created_at) FROM public.settlements s WHERE s.group_id = g.id
      )
    )
WHERE (
      EXISTS (SELECT 1 FROM public.expenses e WHERE e.group_id = g.id)
      OR EXISTS (SELECT 1 FROM public.settlements s WHERE s.group_id = g.id)
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.group_members m
        WHERE m.group_id = g.id AND m.user_id <> g.creator_id
      )
      OR EXISTS (
        SELECT 1 FROM public.group_events ev
        WHERE ev.group_id = g.id
          AND ev.kind IN ('member_joined', 'member_left', 'member_removed')
      )
      OR EXISTS (
        SELECT 1
        FROM public.expenses e
        JOIN public.expense_versions ev
          ON ev.expense_id = e.id AND ev.version_no = e.current_version_no,
        LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(ev.payload->'participants') = 'array'
            THEN ev.payload->'participants'
            ELSE '[]'::jsonb
          END
        ) AS pp(p)
        WHERE e.group_id = g.id
          AND pp.p->>'kind' = 'user'
          AND pp.p ? 'userId'
          AND (pp.p->>'userId')::uuid <> g.creator_id
      )
      OR EXISTS (
        SELECT 1 FROM public.settlements s
        WHERE s.group_id = g.id
          AND (s.from_user_id <> g.creator_id OR s.to_user_id <> g.creator_id)
      )
    );
