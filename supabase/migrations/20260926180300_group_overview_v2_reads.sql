CREATE FUNCTION public.ledger_group_lifecycle_json(p_group_id uuid, p_viewer uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_status public.member_status;
BEGIN
  SELECT status INTO v_status
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_viewer;

  IF v_status IS DISTINCT FROM 'accepted' THEN
    RETURN jsonb_build_object(
      'archivedAt', NULL,
      'financialHistorySharedAt', NULL,
      'formerMembers', '[]'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'archivedAt', to_jsonb((
      SELECT gm.archived_at FROM public.group_members gm
      WHERE gm.group_id = p_group_id AND gm.user_id = p_viewer
    )),
    'financialHistorySharedAt', to_jsonb((
      SELECT g.financial_history_shared_at FROM public.groups g WHERE g.id = p_group_id
    )),
    'formerMembers', COALESCE((
      SELECT jsonb_agg(public.ledger_user_profile_json(gb.participant_id) ORDER BY gb.participant_id)
      FROM public.group_balances gb
      WHERE gb.group_id = p_group_id AND gb.kind = 'user'
        AND NOT EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = p_group_id AND gm.user_id = gb.participant_id
        )
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_group_lifecycle_json(uuid, uuid)
  FROM public, anon, authenticated;

CREATE FUNCTION public.get_group_overview_v2(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := public.current_user_id();
  PERFORM public.assert_member_or_invited(p_group_id, v_user_id);
  RETURN jsonb_build_object(
    'snapshot', public.ledger_group_snapshot_json(p_group_id, v_user_id),
    'overview', public.ledger_group_overview_json(p_group_id, v_user_id)
  ) || public.ledger_group_lifecycle_json(p_group_id, v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_overview_v2(uuid)
  FROM public;
GRANT EXECUTE ON FUNCTION public.get_group_overview_v2(uuid) TO authenticated;

CREATE FUNCTION public.bootstrap_overview_v2() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := public.current_user_id();
  RETURN jsonb_build_object(
    'me', public.ledger_me_json(v_user_id),
    'groups', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY activity_at DESC NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
                 'snapshot', snapshot,
                 'overview', public.ledger_group_overview_json(gm.group_id, v_user_id)
               ) || public.ledger_group_lifecycle_json(gm.group_id, v_user_id) AS row_data,
               (snapshot ->> 'lastActivityAt')::timestamptz AS activity_at
        FROM public.group_members gm
        JOIN LATERAL public.ledger_group_snapshot_json(gm.group_id, v_user_id) snapshot ON true
        WHERE gm.user_id = v_user_id AND gm.status IN ('invited', 'accepted')
      ) rows
    ), '[]'::jsonb),
    'serverTime', to_jsonb(now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_overview_v2()
  FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_overview_v2() TO authenticated;
