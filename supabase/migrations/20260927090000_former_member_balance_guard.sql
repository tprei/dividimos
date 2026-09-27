CREATE OR REPLACE FUNCTION public.recompute_group_balances(p_group_id uuid) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_version bigint;
  v_former_balances jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(gb.participant_id, gb.net_cents), '{}'::jsonb)
    INTO v_former_balances
    FROM public.group_balances gb
   WHERE gb.group_id = p_group_id
     AND gb.kind = 'user'
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = p_group_id AND gm.user_id = gb.participant_id
     );

  DELETE FROM public.group_balances WHERE group_id = p_group_id;
  INSERT INTO public.group_balances (group_id, kind, participant_id, net_cents)
  SELECT p_group_id, kind, participant_id, SUM(delta)
  FROM (
    SELECT cep.kind, COALESCE(cep.user_id, cep.guest_id) AS participant_id,
           (cep.paid_cents - cep.share_cents)::bigint AS delta
    FROM public.current_expense_participants cep
    JOIN public.expenses e ON e.id = cep.expense_id
    WHERE e.group_id = p_group_id
    UNION ALL
    SELECT 'user'::public.participant_kind, s.from_user_id, s.amount_cents::bigint FROM public.settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
    UNION ALL
    SELECT 'user'::public.participant_kind, s.to_user_id, -s.amount_cents::bigint FROM public.settlements s
     WHERE s.group_id = p_group_id AND s.status = 'confirmed'
  ) t
  GROUP BY kind, participant_id
  HAVING SUM(delta) <> 0;
  IF EXISTS (
    SELECT 1
    FROM public.group_balances gb
   WHERE gb.group_id = p_group_id
     AND gb.kind = 'user'
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = p_group_id AND gm.user_id = gb.participant_id
     )
     AND COALESCE(v_former_balances ->> (gb.participant_id::text), '0')::bigint <> gb.net_cents
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'former_member_balance';
  END IF;
  UPDATE public.group_members gm
  SET archived_at = NULL
  WHERE gm.group_id = p_group_id
    AND gm.archived_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.group_balances gb
      WHERE gb.group_id = p_group_id AND gb.kind = 'user' AND gb.participant_id = gm.user_id
    );
  UPDATE public.groups SET ledger_version = ledger_version + 1 WHERE id = p_group_id
    RETURNING ledger_version INTO v_version;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_group_balances(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.decline_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status public.member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind public.group_kind;
  v_event_id bigint;
  v_invalidated boolean := false;
  v_rec record;
BEGIN
  v_actor := public.current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM public.lock_group(p_group_id);

  IF EXISTS (
    SELECT 1 FROM public.group_member_exclusions
    WHERE group_id = p_group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status, invited_by INTO v_status, v_invited_by FROM public.group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  SELECT kind, ledger_version INTO v_kind, v_ledger_version FROM public.groups WHERE id = p_group_id;

  IF v_kind = 'dm' THEN
    IF v_invited_by IS NOT NULL THEN
      PERFORM public.broadcast_user(v_invited_by, p_group_id);
    END IF;
    DELETE FROM public.groups WHERE id = p_group_id;
  ELSE
    FOR v_rec IN
      SELECT
        e.id AS expense_id,
        e.status AS expense_status,
        e.declined_user_ids,
        ev.title,
        ev.total_cents
      FROM public.expenses e
      JOIN public.expense_versions ev
        ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
      WHERE e.group_id = p_group_id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(public.effective_expense_payload(e.id, e.current_version_no)->'participants', '[]'::jsonb)) AS pp(p)
          WHERE pp.p->>'kind' = 'user'
            AND pp.p ? 'userId'
            AND pp.p->>'userId' = v_actor::text
        )
      FOR UPDATE OF e
    LOOP
      IF v_rec.expense_status = 'active' THEN
        UPDATE public.expenses
        SET status = 'deleted',
            deleted_at = now(),
            deleted_by = v_actor,
            declined_user_ids = CASE
              WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
              ELSE array_append(declined_user_ids, v_actor)
            END
        WHERE id = v_rec.expense_id;

        v_event_id := public.emit_event(
          p_group_id, 'expense_deleted', v_actor, v_rec.expense_id,
          NULL, NULL, jsonb_build_object('title', v_rec.title, 'totalCents', v_rec.total_cents)
        );
        v_invalidated := true;
      ELSE
        UPDATE public.expenses
        SET declined_user_ids = CASE
              WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
              ELSE array_append(declined_user_ids, v_actor)
            END
        WHERE id = v_rec.expense_id;
      END IF;
    END LOOP;

    IF v_invalidated THEN
      v_ledger_version := public.recompute_group_balances(p_group_id);
      PERFORM public.broadcast_group(p_group_id, v_ledger_version, v_event_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.group_balances
      WHERE group_id = p_group_id AND kind = 'user' AND participant_id = v_actor
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
    END IF;

    DELETE FROM public.group_members
    WHERE group_id = p_group_id AND user_id = v_actor;
    IF v_invited_by IS NOT NULL THEN
      PERFORM public.broadcast_user(v_invited_by, p_group_id);
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
