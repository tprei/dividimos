CREATE OR REPLACE FUNCTION public.recompute_group_balances(p_group_id uuid) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_version bigint;
BEGIN
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

CREATE FUNCTION public.archive_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_archived_at timestamptz;
BEGIN
  v_actor := public.current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM public.lock_group(p_group_id);
  PERFORM public.assert_member(p_group_id, v_actor);

  IF EXISTS (
    SELECT 1 FROM public.group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
  END IF;

  UPDATE public.group_members
  SET archived_at = COALESCE(archived_at, now())
  WHERE group_id = p_group_id AND user_id = v_actor
  RETURNING archived_at INTO v_archived_at;

  PERFORM public.broadcast_user(v_actor, p_group_id);

  RETURN jsonb_build_object('groupId', p_group_id, 'archivedAt', to_jsonb(v_archived_at));
END;
$$;

REVOKE ALL ON FUNCTION public.archive_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.archive_group(uuid) TO authenticated;

CREATE FUNCTION public.unarchive_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM public.assert_member(p_group_id, v_actor);

  UPDATE public.group_members
  SET archived_at = NULL
  WHERE group_id = p_group_id AND user_id = v_actor;

  PERFORM public.broadcast_user(v_actor, p_group_id);

  RETURN jsonb_build_object('groupId', p_group_id, 'archivedAt', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.unarchive_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.unarchive_group(uuid) TO authenticated;
