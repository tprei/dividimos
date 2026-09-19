SET lock_timeout = '5s';

-- Bind every private room topic to its canonical room id while preserving the
-- existing cryptographically random 32-byte capability suffix.
ALTER TABLE guest_credentials.assignment_room_access
  DROP CONSTRAINT assignment_room_access_broadcast_topic_check;


CREATE FUNCTION guest_credentials.normalize_assignment_room_topic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.broadcast_topic ~ '^assignment-room:[A-Za-z0-9_-]{43}$' THEN
    NEW.broadcast_topic := 'assignment:' || NEW.room_id::text || ':' ||
      substring(NEW.broadcast_topic FROM '^assignment-room:([A-Za-z0-9_-]{43})$');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER normalize_assignment_room_topic
BEFORE INSERT OR UPDATE OF broadcast_topic
ON guest_credentials.assignment_room_access
FOR EACH ROW
EXECUTE FUNCTION guest_credentials.normalize_assignment_room_topic();

ALTER TABLE guest_credentials.assignment_room_access
  ADD CONSTRAINT assignment_room_access_broadcast_topic_check CHECK (
    broadcast_topic ~ '^assignment-room:[A-Za-z0-9_-]{43}$'
    OR broadcast_topic ~ (
      '^assignment:' || room_id::text || ':[A-Za-z0-9_-]{43}$'
    )
  ) NOT VALID;
ALTER TABLE guest_credentials.assignment_room_access
  VALIDATE CONSTRAINT assignment_room_access_broadcast_topic_check;

-- Realtime evaluates this predicate under the JWT role. It deliberately grants
-- no access to the room snapshot or credential tables.
CREATE FUNCTION public.assignment_room_topic_allowed(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, guest_credentials, pg_temp
AS $$
  SELECT CASE
    WHEN p_topic IS NULL OR p_topic !~
      '^assignment:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_-]{43}$'
      THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.assignment_rooms r
      JOIN guest_credentials.assignment_room_access a ON a.room_id = r.id
      WHERE r.id::text = substring(
        p_topic FROM '^assignment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):'
      )
        AND a.broadcast_topic = p_topic
        AND r.status <> 'cancelled'
    )
  END
$$;

REVOKE ALL ON FUNCTION public.assignment_room_topic_allowed(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_room_topic_allowed(text)
  TO anon, authenticated;

CREATE POLICY assignment_room_broadcast_authz
ON realtime.messages
FOR SELECT
TO anon, authenticated
USING (
  extension = 'broadcast'
  AND public.assignment_room_topic_allowed(realtime.topic())
);

-- Broadcasts carry an invalidation revision only. A topic rotation invalidates
-- the old socket and separately wakes clients already on the successor topic.
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
END;
$$;

-- Rotating the join credential does not rotate the subscribed room topic.
CREATE OR REPLACE FUNCTION public.rotate_assignment_room_join(
  p_room_id uuid,
  p_join_token text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_host_participant_id uuid;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_join_token IS NULL
     OR p_join_token !~ '^armj1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;
  IF v_room.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_room_host';
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

  UPDATE guest_credentials.assignment_room_access
  SET join_digest = extensions.digest(convert_to(p_join_token, 'UTF8'), 'sha256'),
      join_expires_at = clock_timestamp() + interval '7 days'
  WHERE room_id = p_room_id;

  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE id = p_room_id;

  SELECT id INTO v_host_participant_id
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND user_id = v_actor AND removed_at IS NULL;

  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
END;
$$;

-- Preserve the ordinary group invalidation, then invalidate only the finalized
-- room linked to the exact expense event. The group RPC already holds the group
-- lock; this acquires the room lock in the same group-then-room order as finalize.
CREATE OR REPLACE FUNCTION public.broadcast_group(
  p_group_id uuid,
  p_ledger_version bigint,
  p_event_id bigint
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id uuid;
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'group_id', p_group_id,
      'ledger_version', p_ledger_version,
      'event_id', p_event_id
    ),
    'ledger',
    'group:' || p_group_id::text,
    true
  );

  SELECT r.id INTO v_room_id
  FROM public.group_events e
  JOIN public.assignment_rooms r
    ON r.expense_id = e.expense_id
   AND r.status = 'finalized'
  WHERE e.id = p_event_id
    AND e.group_id = p_group_id
  FOR UPDATE OF r;

  IF v_room_id IS NOT NULL THEN
    UPDATE public.assignment_rooms
    SET revision = revision + 1
    WHERE id = v_room_id;
    PERFORM public.broadcast_assignment_room(v_room_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION guest_credentials.normalize_assignment_room_topic()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_assignment_room_join(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.broadcast_group(uuid, bigint, bigint)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION guest_credentials.normalize_assignment_room_topic()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.broadcast_assignment_room(uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_assignment_room_join(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_group(uuid, bigint, bigint)
  TO service_role;
