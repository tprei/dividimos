-- decline_invitation soft-deleted the declined expenses but left their
-- expense_participants rows behind, so get_expense kept reporting a nonzero
-- myShareCents for them while delete_expense-deleted expenses reported zero.
-- restore_expense already documents that a deleted expense holds no live
-- participant rows; this makes decline_invitation honour that.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind group_kind;
  v_expense_id uuid;
  v_title text;
  v_total_cents integer;
  v_event_id bigint;
  v_invalidated boolean := false;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

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
    FOR v_expense_id, v_title, v_total_cents IN
      WITH declined_expenses AS (
        UPDATE expenses e
        SET status = 'deleted', deleted_at = now(), deleted_by = v_actor
        WHERE e.group_id = p_group_id
          AND e.status = 'active'
          AND EXISTS (
            SELECT 1 FROM expense_participants p
            WHERE p.expense_id = e.id AND p.user_id = v_actor
          )
        RETURNING e.id, e.current_version_no
      )
      SELECT d.id, ev.title, ev.total_cents
      FROM declined_expenses d
      JOIN expense_versions ev
        ON ev.expense_id = d.id AND ev.version_no = d.current_version_no
    LOOP
      DELETE FROM expense_participants WHERE expense_id = v_expense_id;
      v_event_id := emit_event(
        p_group_id, 'expense_deleted', v_actor, v_expense_id,
        NULL, NULL, jsonb_build_object('title', v_title, 'totalCents', v_total_cents)
      );
      v_invalidated := true;
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
