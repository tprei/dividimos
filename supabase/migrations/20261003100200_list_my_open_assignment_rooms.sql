-- A home card wants every open room the caller could join, across all their
-- groups and DMs, in one read instead of one RPC per group on every sign-in.
-- Same summary shape, exclusions and per-group cap as
-- list_open_assignment_rooms, driven from the caller's accepted memberships
-- so the scan never leaves them.
CREATE FUNCTION public.list_my_open_assignment_rooms()
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_user_id();
  RETURN jsonb_build_object('rooms', COALESCE((
    SELECT jsonb_agg(v.room ORDER BY v.created_at DESC, v.id DESC)
    FROM public.group_members gm
    CROSS JOIN LATERAL (
      SELECT public.assignment_room_summary_json(r.id)
             || jsonb_build_object('joined', EXISTS (
                 SELECT 1
                 FROM public.assignment_room_participants p
                 WHERE p.room_id = r.id
                   AND p.user_id = v_actor
                   AND p.removed_at IS NULL
               )) AS room,
             r.created_at,
             r.id
      FROM public.assignment_rooms r
      WHERE r.status = 'open'
        AND r.group_target->>'kind' = 'existing'
        AND (r.group_target->>'groupId')::uuid = gm.group_id
        -- A caller whose participant row the host removed (and who has no
        -- active row anymore) must not see the room: enter would answer
        -- invalid_token, so the card would dangle forever.
        AND NOT (
          EXISTS (
            SELECT 1
            FROM public.assignment_room_participants p
            WHERE p.room_id = r.id
              AND p.user_id = v_actor
              AND p.removed_at IS NOT NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.assignment_room_participants p
            WHERE p.room_id = r.id
              AND p.user_id = v_actor
              AND p.removed_at IS NULL
          )
        )
        -- A block between caller and host hides the room unless the caller
        -- already has an active row in it.
        AND NOT (
          EXISTS (
            SELECT 1 FROM public.user_blocks b
            WHERE (b.blocker_id = v_actor AND b.blocked_id = r.host_user_id)
               OR (b.blocker_id = r.host_user_id AND b.blocked_id = v_actor)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.assignment_room_participants p
            WHERE p.room_id = r.id
              AND p.user_id = v_actor
              AND p.removed_at IS NULL
          )
        )
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 20
    ) v
    WHERE gm.user_id = v_actor
      AND gm.status = 'accepted'
  ), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_open_assignment_rooms()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_open_assignment_rooms()
  TO authenticated;
