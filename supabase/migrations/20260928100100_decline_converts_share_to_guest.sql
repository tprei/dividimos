-- decline_invitation soft-deleted every bill naming the invited decliner,
-- erasing the debts of the members who had accepted, and restore_expense
-- then failed with invitation_not_accepted. Only a payer share voids a bill
-- now; any other decliner slot becomes a guest with their name on a new
-- version, so the bill and the other balances stay intact.
CREATE OR REPLACE FUNCTION public.decline_invitation(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind group_kind;
  v_event_id bigint;
  v_invalidated boolean := false;
  v_new_payload jsonb;
  v_new_version_no integer;
  v_change_summary jsonb;
  v_display_name text;
  v_is_payer boolean;
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
        e.current_version_no,
        ev.occurred_on,
        ev.title,
        ev.merchant_name,
        ev.expense_type,
        ev.total_cents,
        ev.service_fee_bps,
        ev.fixed_fee_cents,
        ep.payload,
        pi.participant_index
      FROM expenses e
      JOIN expense_versions ev
        ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
      CROSS JOIN LATERAL effective_expense_payload(e.id, e.current_version_no) AS ep(payload)
      CROSS JOIN LATERAL (
        SELECT (ord.idx - 1)::integer AS participant_index
        FROM jsonb_array_elements(COALESCE(ep.payload->'participants', '[]'::jsonb))
          WITH ORDINALITY AS ord(p, idx)
        WHERE ord.p->>'kind' = 'user'
          AND ord.p ? 'userId'
          AND ord.p->>'userId' = v_actor::text
        LIMIT 1
      ) pi
      WHERE e.group_id = p_group_id
      FOR UPDATE OF e
    LOOP
      v_is_payer := EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(v_rec.payload->'payers', '[]'::jsonb)) AS py(p)
        WHERE (py.p->>'participantIndex')::integer = v_rec.participant_index
      );

      IF v_is_payer THEN
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
      ELSE
        v_display_name := (
          SELECT name FROM public.users WHERE id = v_actor
        );
        v_new_payload := jsonb_set(
          v_rec.payload,
          ARRAY['participants', v_rec.participant_index::text],
          jsonb_build_object('kind', 'guest', 'displayName', v_display_name)
        );
        v_new_payload := resolve_expense_participants(v_rec.expense_id, v_new_payload);
        v_new_version_no := v_rec.current_version_no + 1;
        INSERT INTO expense_versions (
          expense_id, version_no, author_id, occurred_on, title, merchant_name, expense_type,
          total_cents, service_fee_bps, fixed_fee_cents, payload, change_summary
        ) VALUES (
          v_rec.expense_id, v_new_version_no, v_actor, v_rec.occurred_on, v_rec.title, v_rec.merchant_name,
          v_rec.expense_type, v_rec.total_cents, v_rec.service_fee_bps, v_rec.fixed_fee_cents,
          v_new_payload, NULL
        );
        v_change_summary := expense_change_summary(v_rec.expense_id, v_rec.current_version_no, v_new_version_no);
        UPDATE expense_versions SET change_summary = v_change_summary
        WHERE expense_id = v_rec.expense_id AND version_no = v_new_version_no;

        UPDATE expenses
        SET current_version_no = v_new_version_no,
            declined_user_ids = array_remove(declined_user_ids, v_actor)
        WHERE id = v_rec.expense_id;

        IF v_rec.expense_status = 'active' THEN
          v_event_id := emit_event(
            p_group_id, 'expense_edited', v_actor, v_rec.expense_id,
            NULL, NULL, v_change_summary
          );
        END IF;
        v_invalidated := true;
      END IF;
    END LOOP;

    IF v_invalidated THEN
      v_ledger_version := recompute_group_balances(p_group_id);
      PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
    END IF;

    IF EXISTS (SELECT 1 FROM group_balances WHERE group_id = p_group_id AND kind = 'user' AND participant_id = v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
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
$function$;

REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO service_role, authenticated;
