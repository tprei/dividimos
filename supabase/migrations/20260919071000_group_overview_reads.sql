CREATE FUNCTION public.ledger_group_overview_json(
  p_group_id uuid,
  p_viewer uuid
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind group_kind;
  v_status member_status;
  v_avatar jsonb;
  v_spending jsonb;
BEGIN
  SELECT g.kind, gm.status,
         CASE
           WHEN g.avatar_photo_id IS NOT NULL THEN
             jsonb_build_object('kind', 'photo', 'photoId', g.avatar_photo_id::text)
           WHEN g.avatar_emoji IS NOT NULL THEN
             jsonb_build_object('kind', 'emoji', 'emoji', g.avatar_emoji)
           ELSE jsonb_build_object('kind', 'initials')
         END
    INTO v_kind, v_status, v_avatar
  FROM groups g
  LEFT JOIN group_members gm
    ON gm.group_id = g.id AND gm.user_id = p_viewer
  WHERE g.id = p_group_id;

  IF v_kind IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_kind = 'dm' OR v_status IS DISTINCT FROM 'accepted' THEN
    RETURN jsonb_build_object(
      'avatar', jsonb_build_object('kind', 'initials'),
      'spending', 'null'::jsonb
    );
  END IF;

  WITH share_totals AS (
    SELECT cep.kind,
           COALESCE(cep.user_id, cep.guest_id) AS participant_id,
           SUM(cep.share_cents)::bigint AS share_cents
    FROM current_expense_participants cep
    JOIN expenses e ON e.id = cep.expense_id
    WHERE e.group_id = p_group_id AND e.status = 'active'
    GROUP BY cep.kind, COALESCE(cep.user_id, cep.guest_id)
  ),
  member_rows AS (
    SELECT 'user'::participant_kind AS kind,
           gm.user_id AS participant_id,
           0::bigint AS share_cents
    FROM group_members gm
    WHERE gm.group_id = p_group_id AND gm.status = 'accepted'
  ),
  participants AS (
    SELECT kind, participant_id, MAX(share_cents)::bigint AS share_cents
    FROM (
      SELECT kind, participant_id, share_cents FROM share_totals
      UNION ALL
      SELECT kind, participant_id, share_cents FROM member_rows
    ) rows
    GROUP BY kind, participant_id
  ),
  participant_json AS (
    SELECT jsonb_agg(
      CASE
        WHEN p.kind = 'user'::participant_kind THEN jsonb_build_object(
          'kind', 'user',
          'participantId', p.participant_id,
          'user', ledger_user_profile_json(p.participant_id),
          'shareCents', p.share_cents
        )
        ELSE jsonb_build_object(
          'kind', 'guest',
          'participantId', p.participant_id,
          'displayName', guest.display_name,
          'shareCents', p.share_cents
        )
      END
      ORDER BY p.kind, p.participant_id
    ) AS value
    FROM participants p
    LEFT JOIN guests guest
      ON guest.id = p.participant_id AND p.kind = 'guest'::participant_kind
  ),
  group_total AS (
    SELECT COALESCE(SUM(ev.total_cents), 0)::bigint AS total_cents
    FROM expenses e
    JOIN expense_versions ev
      ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
    WHERE e.group_id = p_group_id AND e.status = 'active'
  )
  SELECT jsonb_build_object(
    'totalCents', group_total.total_cents,
    'participants', COALESCE(participant_json.value, '[]'::jsonb)
  )
    INTO v_spending
  FROM group_total
  CROSS JOIN participant_json;

  RETURN jsonb_build_object('avatar', v_avatar, 'spending', v_spending);
END;
$$;

CREATE FUNCTION public.get_group_overview(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := current_user_id();
  PERFORM assert_member_or_invited(p_group_id, v_user_id);
  RETURN jsonb_build_object(
    'snapshot', ledger_group_snapshot_json(p_group_id, v_user_id),
    'overview', ledger_group_overview_json(p_group_id, v_user_id)
  );
END;
$$;

CREATE FUNCTION public.bootstrap_overview() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := current_user_id();
  RETURN jsonb_build_object(
    'me', ledger_me_json(v_user_id),
    'groups', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY activity_at DESC NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
                 'snapshot', snapshot,
                 'overview', ledger_group_overview_json(gm.group_id, v_user_id)
               ) AS row_data,
               (snapshot ->> 'lastActivityAt')::timestamptz AS activity_at
        FROM group_members gm
        JOIN LATERAL ledger_group_snapshot_json(gm.group_id, v_user_id) snapshot ON true
        WHERE gm.user_id = v_user_id AND gm.status IN ('invited', 'accepted')
      ) rows
    ), '[]'::jsonb),
    'serverTime', to_jsonb(now())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ledger_group_overview_json(uuid, uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_group_overview(uuid)
  FROM public;
GRANT EXECUTE ON FUNCTION public.get_group_overview(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_overview()
  FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_overview() TO authenticated;
