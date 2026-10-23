-- Hosts can share a spoken two-word room code; a server route trades it for a single-use join grant that join_assignment_room accepts like a link token.
SET lock_timeout = '5s';

CREATE TABLE guest_credentials.assignment_room_codes (
  room_id uuid PRIMARY KEY REFERENCES public.assignment_rooms(id) ON DELETE CASCADE,
  code_digest bytea NOT NULL UNIQUE CHECK (octet_length(code_digest) = 32),
  join_digest bytea NOT NULL CHECK (octet_length(join_digest) = 32),
  expires_at timestamptz NOT NULL
);

CREATE TABLE guest_credentials.assignment_room_code_grants (
  grant_digest bytea PRIMARY KEY CHECK (octet_length(grant_digest) = 32),
  room_id uuid NOT NULL REFERENCES public.assignment_rooms(id) ON DELETE CASCADE,
  join_digest bytea NOT NULL CHECK (octet_length(join_digest) = 32),
  expires_at timestamptz NOT NULL
);
CREATE INDEX assignment_room_code_grants_room_id_idx
  ON guest_credentials.assignment_room_code_grants (room_id);

ALTER TABLE guest_credentials.assignment_room_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_credentials.assignment_room_code_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE guest_credentials.assignment_room_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE guest_credentials.assignment_room_code_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE guest_credentials.assignment_room_codes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE guest_credentials.assignment_room_code_grants TO service_role;

CREATE OR REPLACE FUNCTION public.issue_assignment_room_code(p_room_id uuid, p_code text)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_access guest_credentials.assignment_room_access%ROWTYPE;
  v_code_digest bytea;
  v_ttl interval := interval '15 minutes';
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_code IS NULL OR p_code !~ '^[a-z]{3,10}-[a-z]{3,10}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT public.increment_rate_limit('room_code_issues', v_actor::text, 60, 3600) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_code_rate_limited';
  END IF;

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND OR v_room.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

  SELECT * INTO v_access
  FROM guest_credentials.assignment_room_access
  WHERE room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND OR v_access.join_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

  v_code_digest := extensions.digest(convert_to(p_code, 'UTF8'), 'sha256');

  DELETE FROM guest_credentials.assignment_room_codes
  WHERE room_id = p_room_id;
  DELETE FROM guest_credentials.assignment_room_codes
  WHERE code_digest = v_code_digest AND expires_at <= clock_timestamp();

  INSERT INTO guest_credentials.assignment_room_codes (
    room_id, code_digest, join_digest, expires_at
  ) VALUES (
    p_room_id, v_code_digest, v_access.join_digest, clock_timestamp() + v_ttl
  )
  ON CONFLICT (code_digest) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_code_taken';
  END IF;

  RETURN jsonb_build_object('expiresInSeconds', extract(epoch FROM v_ttl)::integer);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_assignment_room_code(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_assignment_room_code(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_assignment_room_code(p_code text, p_grant_token text)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_room_id uuid;
  v_join_digest bytea;
BEGIN
  IF p_grant_token IS NULL OR p_grant_token !~ '^armr1_[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[a-z]{3,10}-[a-z]{3,10}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_room_code';
  END IF;

  SELECT c.room_id, c.join_digest INTO v_room_id, v_join_digest
  FROM guest_credentials.assignment_room_codes c
  JOIN guest_credentials.assignment_room_access a ON a.room_id = c.room_id
  JOIN public.assignment_rooms r ON r.id = c.room_id
  WHERE c.code_digest = extensions.digest(convert_to(p_code, 'UTF8'), 'sha256')
    AND c.expires_at > clock_timestamp()
    AND c.join_digest = a.join_digest
    AND a.join_expires_at > clock_timestamp()
    AND r.status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_room_code';
  END IF;

  DELETE FROM guest_credentials.assignment_room_code_grants
  WHERE room_id = v_room_id AND expires_at <= clock_timestamp();

  INSERT INTO guest_credentials.assignment_room_code_grants (
    grant_digest, room_id, join_digest, expires_at
  ) VALUES (
    extensions.digest(convert_to(p_grant_token, 'UTF8'), 'sha256'),
    v_room_id,
    v_join_digest,
    clock_timestamp() + interval '10 minutes'
  )
  ON CONFLICT (grant_digest) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  RETURN jsonb_build_object('roomId', v_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_assignment_room_code(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_assignment_room_code(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.join_assignment_room(p_room_id uuid, p_join_token text, p_member_token text, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'guest_credentials', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_room public.assignment_rooms%ROWTYPE;
  v_access guest_credentials.assignment_room_access%ROWTYPE;
  v_member guest_credentials.assignment_room_members%ROWTYPE;
  v_participant public.assignment_room_participants%ROWTYPE;
  v_join_digest bytea;
  v_member_digest bytea;
  v_display_name text;
  v_active_count integer;
  v_next_ordinal integer;
  v_group_kind public.group_kind;
  v_dm_user_a uuid;
  v_dm_user_b uuid;
  v_dm_room boolean := false;
BEGIN
  IF p_room_id IS NULL
     OR p_join_token IS NULL
     OR p_join_token !~ '^arm[jr]1_[A-Za-z0-9_-]{43}$'
     OR p_member_token IS NULL
     OR p_member_token !~ '^armm1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_join_digest := extensions.digest(convert_to(p_join_token, 'UTF8'), 'sha256');
  v_member_digest := extensions.digest(convert_to(p_member_token, 'UTF8'), 'sha256');

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT m.* INTO v_member
  FROM guest_credentials.assignment_room_members m
  JOIN public.assignment_room_participants p
    ON p.room_id = m.room_id AND p.id = m.participant_id
  WHERE m.room_id = p_room_id AND m.token_digest = v_member_digest
  FOR UPDATE OF m, p;
  IF FOUND THEN
    SELECT * INTO v_participant
    FROM public.assignment_room_participants
    WHERE room_id = v_member.room_id AND id = v_member.participant_id
    FOR UPDATE;
    IF v_room.status = 'cancelled'
       OR v_member.revoked_at IS NOT NULL
       OR v_member.expires_at <= clock_timestamp()
       OR v_participant.removed_at IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
    END IF;
    RETURN public.assignment_room_view(
      p_room_id,
      v_participant.id,
      v_actor IS NOT NULL AND v_actor = v_room.host_user_id
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM guest_credentials.assignment_room_members
    WHERE token_digest = v_member_digest
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT * INTO v_access
  FROM guest_credentials.assignment_room_access
  WHERE room_id = p_room_id
  FOR UPDATE;
  IF NOT FOUND OR v_access.join_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;
  IF left(p_join_token, 6) = 'armj1_' THEN
    IF v_access.join_digest <> v_join_digest THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
    END IF;
  ELSE
    DELETE FROM guest_credentials.assignment_room_code_grants
    WHERE grant_digest = v_join_digest
      AND room_id = p_room_id
      AND join_digest = v_access.join_digest
      AND expires_at > clock_timestamp();
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
    END IF;
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

  IF v_room.group_target->>'kind' = 'existing' THEN
    SELECT g.kind, g.dm_user_a, g.dm_user_b
      INTO v_group_kind, v_dm_user_a, v_dm_user_b
    FROM public.groups g
    WHERE g.id = (v_room.group_target->>'groupId')::uuid;
    v_dm_room := v_group_kind IS NOT DISTINCT FROM 'dm';
  END IF;
  IF v_dm_room AND (v_actor IS NULL
     OR (v_actor IS DISTINCT FROM v_dm_user_a AND v_actor IS DISTINCT FROM v_dm_user_b)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'dm_room_pair_only';
  END IF;

  -- An account that never completed onboarding joins as a guest, so
  -- finalization never invites it: the group RPCs refuse users that never
  -- onboarded. It still re-enters through the member token above.
  IF v_actor IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.user_blocks b
       WHERE (b.blocker_id = v_actor AND b.blocked_id = v_room.host_user_id)
          OR (b.blocker_id = v_room.host_user_id AND b.blocked_id = v_actor)
     )
     AND EXISTS (
       SELECT 1 FROM public.users
       WHERE id = v_actor AND onboarded
     ) THEN
    SELECT * INTO v_participant
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id
      AND user_id = v_actor
      AND removed_at IS NULL
    FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO v_member
      FROM guest_credentials.assignment_room_members
      WHERE room_id = p_room_id AND participant_id = v_participant.id
      FOR UPDATE;
      IF FOUND AND v_member.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
      END IF;

      INSERT INTO guest_credentials.assignment_room_members (
        room_id, participant_id, token_digest, expires_at, revoked_at
      ) VALUES (
        p_room_id, v_participant.id, v_member_digest,
        clock_timestamp() + interval '30 days', NULL
      )
      ON CONFLICT (room_id, participant_id) DO UPDATE
      SET token_digest = EXCLUDED.token_digest,
          expires_at = EXCLUDED.expires_at,
          revoked_at = NULL;

      RETURN public.assignment_room_view(
        p_room_id,
        v_participant.id,
        v_actor = v_room.host_user_id
      );
    END IF;

    -- A host who removed this account already released its choices; a
    -- forwarded fresh invitation must not resurrect that participant.
    IF EXISTS (
      SELECT 1
      FROM public.assignment_room_participants
      WHERE room_id = p_room_id AND user_id = v_actor
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
    END IF;

    -- Bearer admission never overrides a group exclusion. Rejecting here keeps
    -- the room recordable: finalization would raise `member_excluded` on a
    -- room that can no longer change hands.
    IF v_room.group_target->>'kind' = 'existing' AND EXISTS (
      SELECT 1
      FROM public.group_member_exclusions
      WHERE group_id = (v_room.group_target->>'groupId')::uuid
        AND user_id = v_actor
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
    END IF;

    -- The account's own profile names it. `p_display_name` is ignored, so a
    -- forged name cannot impersonate somebody else in the room.
    SELECT name INTO v_display_name
    FROM public.users
    WHERE id = v_actor;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
    END IF;
    v_display_name := btrim(v_display_name);
    IF v_display_name IS NULL OR length(v_display_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    -- Capacity counts active rows; the ordinal spans every row, because
    -- `(room_id, ordinal)` is unique and removed participants keep theirs.
    SELECT (count(*) FILTER (WHERE removed_at IS NULL))::integer,
           COALESCE(max(ordinal), -1) + 1
    INTO v_active_count, v_next_ordinal
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id;
    IF v_active_count >= 50 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'too_many_participants';
    END IF;

    INSERT INTO public.assignment_room_participants (
      room_id, id, ordinal, display_name, user_id
    ) VALUES (
      p_room_id, gen_random_uuid(), v_next_ordinal, v_display_name, v_actor
    ) RETURNING * INTO v_participant;

    INSERT INTO guest_credentials.assignment_room_members (
      room_id, participant_id, token_digest, expires_at
    ) VALUES (
      p_room_id, v_participant.id, v_member_digest,
      clock_timestamp() + interval '30 days'
    );

    UPDATE public.assignment_rooms
    SET revision = revision + 1
    WHERE id = p_room_id
    RETURNING * INTO v_room;
    PERFORM public.broadcast_assignment_room(p_room_id);
    RETURN public.assignment_room_view(p_room_id, v_participant.id, false);
  END IF;

  IF v_dm_room THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'dm_room_pair_only';
  END IF;

  v_display_name := btrim(p_display_name);
  -- The client sends an empty name when an account joins, so a signed-in
  -- joiner without onboarding falls back to its own profile name; the
  -- guest validation below decides whether it is usable.
  IF v_actor IS NOT NULL AND COALESCE(v_display_name, '') = '' THEN
    SELECT btrim(name) INTO v_display_name
    FROM public.users
    WHERE id = v_actor;
  END IF;
  IF v_display_name IS NULL OR length(v_display_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT (count(*) FILTER (WHERE removed_at IS NULL))::integer,
         COALESCE(max(ordinal), -1) + 1
  INTO v_active_count, v_next_ordinal
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id;
  IF v_active_count >= 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'too_many_participants';
  END IF;

  INSERT INTO public.assignment_room_participants (
    room_id, id, ordinal, display_name, user_id
  ) VALUES (
    p_room_id, gen_random_uuid(), v_next_ordinal, v_display_name, NULL
  ) RETURNING * INTO v_participant;

  INSERT INTO guest_credentials.assignment_room_members (
    room_id, participant_id, token_digest, expires_at
  ) VALUES (
    p_room_id, v_participant.id, v_member_digest,
    clock_timestamp() + interval '30 days'
  );

  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE id = p_room_id
  RETURNING * INTO v_room;
  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN public.assignment_room_view(p_room_id, v_participant.id, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.join_assignment_room(p_room_id uuid, p_join_token text, p_member_token text, p_display_name text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_assignment_room(p_room_id uuid, p_join_token text, p_member_token text, p_display_name text)
  TO anon, authenticated, service_role;
