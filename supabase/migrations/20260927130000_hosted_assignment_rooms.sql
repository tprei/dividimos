-- A host who walks away from a room needs a way back that does not depend on
-- the group screen: rooms opened from a scan outside any group have no group
-- card or chat card. `assignment_room_summary_json` now describes every room,
-- with a null `groupId` for rooms whose group is only created at finalize, and
-- `list_hosted_assignment_rooms` lists the caller's open and in-review rooms.
-- The group-topic broadcast keeps skipping rooms without a group.
CREATE OR REPLACE FUNCTION public.assignment_room_summary_json(p_room_id uuid)
RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'groupId', CASE
      WHEN r.group_target->>'kind' = 'existing' THEN (r.group_target->>'groupId')::uuid
      ELSE NULL
    END,
    'status', r.status,
    'revision', r.revision,
    'title', r.header->>'title',
    'occurredOn', r.header->>'occurredOn',
    'totalCents', (
      SELECT COALESCE(sum(i.total_price_cents), 0)
        + floor((
          COALESCE(sum(i.total_price_cents), 0)::numeric
            * (r.header->>'serviceFeeBasisPoints')::integer
          + 5000
        ) / 10000)
        + (r.header->>'fixedFeeCents')::integer
      FROM public.assignment_room_items i
      WHERE i.room_id = r.id
    ),
    'host', public.ledger_user_profile_json(r.host_user_id),
    'createdAt', to_jsonb(r.created_at),
    'itemCount', (
      SELECT count(*) FROM public.assignment_room_items i WHERE i.room_id = r.id
    ),
    'ownedItemCount', (
      SELECT count(*)
      FROM public.assignment_room_items i
      WHERE i.room_id = r.id
        AND COALESCE((
          SELECT sum(c.ticks)
          FROM public.assignment_room_claims c
          JOIN public.assignment_room_participants p
            ON p.room_id = c.room_id AND p.id = c.participant_id
          WHERE c.room_id = i.room_id
            AND c.item_id = i.id
            AND p.removed_at IS NULL
        ), 0) = i.quantity_milliunits::bigint * 120
    ),
    'claimers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'participantId', p.id,
        'userId', p.user_id,
        'name', p.display_name,
        'avatarUrl', u.avatar_url
      ) ORDER BY p.ordinal)
      FROM public.assignment_room_participants p
      LEFT JOIN public.users u ON u.id = p.user_id
      WHERE p.room_id = r.id
        AND p.removed_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.assignment_room_claims c
          WHERE c.room_id = r.id
            AND c.participant_id = p.id
        )
    ), '[]'::jsonb),
    'expenseId', r.expense_id
  )
  FROM public.assignment_rooms r
  WHERE r.id = p_room_id
$$;

REVOKE ALL ON FUNCTION public.assignment_room_summary_json(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_room_summary_json(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.broadcast_assignment_room(
  p_room_id uuid,
  p_event text DEFAULT 'assignment',
  p_topic text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_revision bigint;
  v_topic text;
  v_current_topic text;
  v_summary jsonb;
BEGIN
  SELECT r.revision, a.broadcast_topic
  INTO v_revision, v_current_topic
  FROM public.assignment_rooms r
  JOIN guest_credentials.assignment_room_access a ON a.room_id = r.id
  WHERE r.id = p_room_id;

  IF NOT FOUND OR v_current_topic IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;

  v_topic := COALESCE(p_topic, v_current_topic);
  PERFORM realtime.send(
    jsonb_build_object('revision', v_revision),
    CASE WHEN p_event = 'access_changed' THEN 'access_changed' ELSE 'assignment' END,
    v_topic,
    true
  );

  IF p_event = 'access_changed' AND v_topic <> v_current_topic THEN
    PERFORM realtime.send(
      jsonb_build_object('revision', v_revision),
      'assignment',
      v_current_topic,
      true
    );
  END IF;

  v_summary := public.assignment_room_summary_json(p_room_id);
  IF v_summary->>'groupId' IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('room', v_summary),
      'assignment_room',
      'group:' || (v_summary->>'groupId'),
      true
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  TO service_role;

CREATE FUNCTION public.list_hosted_assignment_rooms()
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
    FROM (
      SELECT public.assignment_room_summary_json(r.id)
             || jsonb_build_object('groupName', g.name) AS room,
             r.created_at,
             r.id
      FROM public.assignment_rooms r
      LEFT JOIN public.groups g
        ON r.group_target->>'kind' = 'existing'
       AND g.id = (r.group_target->>'groupId')::uuid
       AND public.is_member(g.id, v_actor)
      WHERE r.host_user_id = v_actor
        AND r.status IN ('open', 'closed')
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 20
    ) v
  ), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.list_hosted_assignment_rooms()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_hosted_assignment_rooms()
  TO authenticated;
