-- Decline metadata and restoration denial (P7 / amended plan S5).
--
-- Defect:
--   A pending participant declines an expense; its creator restores it and the
--   declined user's debt returns. The resolver intentionally permits historical
--   participants after ordinary departure (a supported contract), so the fix is
--   explicit decline metadata, not a resolver clampdown.
--
-- Column:
--   public.expenses.declined_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
--   CONSTRAINT expenses_declined_users_valid CHECK (
--     cardinality(declined_user_ids) <= 50 AND array_position(declined_user_ids, NULL) IS NULL
--   )
--
-- RPC changes:
--   decline_invitation: on decline of an expense invitation in a named group,
--     inspect the current version's effective user participants even if the
--     expense is already deleted; record the declining actor in every affected
--     expense's declined_user_ids (append-only, deduped); soft-delete + emit
--     the normal deletion event only for expenses transitioning from active.
--   restore_expense: require every recorded decliner to currently hold
--     accepted membership; otherwise raise invitation_not_accepted without
--     changing facts, lifecycle, events, or balances; clear declined_user_ids
--     only on successful restoration.
--
-- Backfill:
--   declined_user_ids stays empty: existing deleted rows cannot be classified
--   reliably as manual deletion versus invitation refusal because the current
--   schema stores only deleted_by. Backfill declined_user_ids as empty rather
--   than inventing consent history. New declines are protected from the moment
--   P7 lands. This is an explicit disposable-playground limitation before the
--   empty epoch reset.

set check_function_bodies = off;

ALTER TABLE public.expenses ADD COLUMN declined_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
ALTER TABLE public.expenses ADD CONSTRAINT expenses_declined_users_valid CHECK (
  cardinality(declined_user_ids) <= 50 AND array_position(declined_user_ids, NULL) IS NULL
);

CREATE OR REPLACE FUNCTION public.decline_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind group_kind;
  v_event_id bigint;
  v_invalidated boolean := false;
  v_rec record;
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

  SELECT kind, ledger_version INTO v_kind, v_ledger_version FROM groups WHERE id = p_group_id;

  IF v_kind = 'dm' THEN
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
    DELETE FROM groups WHERE id = p_group_id;
  ELSE
    FOR v_rec IN
      SELECT
        e.id AS expense_id,
        e.status AS expense_status,
        e.declined_user_ids,
        ev.title,
        ev.total_cents
      FROM expenses e
      JOIN expense_versions ev
        ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
      WHERE e.group_id = p_group_id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(ev.payload->'participants', '[]'::jsonb)) AS pp(p)
          WHERE pp.p->>'kind' = 'user'
            AND pp.p ? 'userId'
            AND pp.p->>'userId' = v_actor::text
        )
      FOR UPDATE OF e
    LOOP
      IF v_rec.expense_status = 'active' THEN
        UPDATE expenses
        SET status = 'deleted',
            deleted_at = now(),
            deleted_by = v_actor,
            declined_user_ids = CASE
              WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
              ELSE array_append(declined_user_ids, v_actor)
            END
        WHERE id = v_rec.expense_id;

        DELETE FROM expense_participants WHERE expense_id = v_rec.expense_id;

        v_event_id := emit_event(
          p_group_id, 'expense_deleted', v_actor, v_rec.expense_id,
          NULL, NULL, jsonb_build_object('title', v_rec.title, 'totalCents', v_rec.total_cents)
        );
        v_invalidated := true;
      ELSE
        UPDATE expenses
        SET declined_user_ids = CASE
              WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
              ELSE array_append(declined_user_ids, v_actor)
            END
        WHERE id = v_rec.expense_id;
      END IF;
    END LOOP;

    IF v_invalidated THEN
      v_ledger_version := recompute_group_balances(p_group_id);
      PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
    END IF;

    DELETE FROM group_members
    WHERE group_id = p_group_id AND user_id = v_actor;
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO authenticated;

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
  v_declined_user_ids uuid[];
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

  SELECT status, current_version_no, creator_id, chave_acesso, declined_user_ids
    INTO v_status, v_version_no, v_creator_id, v_chave_acesso, v_declined_user_ids
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

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(v_declined_user_ids, '{}'::uuid[])) AS d(user_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM group_members gm
      WHERE gm.group_id = v_group_id
        AND gm.user_id = d.user_id
        AND gm.status = 'accepted'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invitation_not_accepted';
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
    UPDATE expenses
    SET status = 'active',
        deleted_at = NULL,
        deleted_by = NULL,
        declined_user_ids = '{}'::uuid[]
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
