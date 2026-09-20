-- Signed-in people can now accept a room invitation.
--
-- Rooms are created with the host as their only participant, so the previous
-- `join_assignment_room` rejected every authenticated invite holder that was
-- not preseeded: the QR worked for anonymous guests and for nobody else. An
-- account that joins keeps its ledger identity, which means
-- `assignment_room_expense_payload` only emits a `user` ref when the person is
-- a member or invitee of the target group. `finalize_assignment_room`
-- therefore invites every account participant into that group through the
-- ordinary `invite_member` workflow before comparing the expected payload.
--
-- `remove_assignment_room_participant` also accepts a `closed` room, so a host
-- reviewing the bill can correct a participant whose group permission changed
-- after they joined instead of holding an unrecordable room forever.

CREATE OR REPLACE FUNCTION public.join_assignment_room(
  p_room_id uuid,
  p_join_token text,
  p_member_token text,
  p_display_name text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
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
BEGIN
  IF p_room_id IS NULL
     OR p_join_token IS NULL
     OR p_join_token !~ '^armj1_[A-Za-z0-9_-]{43}$'
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
  IF NOT FOUND
     OR v_access.join_digest <> v_join_digest
     OR v_access.join_expires_at <= clock_timestamp()
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;
  IF v_room.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;

  IF v_actor IS NOT NULL THEN
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

  v_display_name := btrim(p_display_name);
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
$$;

CREATE OR REPLACE FUNCTION public.remove_assignment_room_participant(
  p_room_id uuid,
  p_participant_id uuid,
  p_expected_revision bigint,
  p_join_token text
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_participant public.assignment_room_participants%ROWTYPE;
  v_access guest_credentials.assignment_room_access%ROWTYPE;
  v_host_participant_id uuid;
  v_old_topic text;
  v_new_topic text;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_participant_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_join_token IS NULL
     OR p_join_token !~ '^armj1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;
  IF v_room.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;
  -- A closed room is still correctable by its host: the review screen needs a
  -- way out when someone's group permission changed after they joined.
  IF v_room.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_closed';
  END IF;
  IF v_room.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  SELECT * INTO v_participant
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND id = p_participant_id
  FOR UPDATE;
  IF NOT FOUND OR v_participant.removed_at IS NOT NULL OR v_participant.ordinal = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_access
  FROM guest_credentials.assignment_room_access
  WHERE room_id = p_room_id
  FOR UPDATE;
  v_old_topic := v_access.broadcast_topic;

  UPDATE public.assignment_room_participants
  SET removed_at = clock_timestamp()
  WHERE room_id = p_room_id AND id = p_participant_id;
  DELETE FROM public.assignment_room_claims
  WHERE room_id = p_room_id AND participant_id = p_participant_id;
  UPDATE guest_credentials.assignment_room_members
  SET revoked_at = clock_timestamp()
  WHERE room_id = p_room_id
    AND participant_id = p_participant_id
    AND revoked_at IS NULL;

  v_new_topic := 'assignment-room:' || rtrim(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );
  UPDATE guest_credentials.assignment_room_access
  SET join_digest = extensions.digest(convert_to(p_join_token, 'UTF8'), 'sha256'),
      join_expires_at = clock_timestamp() + interval '7 days',
      broadcast_topic = v_new_topic
  WHERE room_id = p_room_id;
  UPDATE public.assignment_rooms
  SET revision = revision + 1
  WHERE id = p_room_id;

  SELECT id INTO v_host_participant_id
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND user_id = v_actor AND removed_at IS NULL;
  PERFORM public.broadcast_assignment_room(p_room_id, 'access_changed', v_old_topic);
  RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_assignment_room(
  p_room_id uuid,
  p_expected_revision bigint,
  p_payload jsonb
) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_preview public.assignment_rooms%ROWTYPE;
  v_room public.assignment_rooms%ROWTYPE;
  v_group_id uuid;
  v_group_result jsonb;
  v_host_participant_id uuid;
  v_participant_user_id uuid;
  v_subtotal bigint;
  v_service_fee bigint;
  v_total bigint;
  v_validated_payload jsonb;
  v_expected_payload jsonb;
  v_ack jsonb;
  v_expense_id uuid;
  v_existing_client_expense uuid;
  v_existing_group_id uuid;
  v_existing_status public.expense_status;
  v_existing_version integer;
  v_ledger_version bigint;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_expected_revision IS NULL
     OR p_expected_revision < 1 OR p_payload IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_preview
  FROM public.assignment_rooms
  WHERE id = p_room_id;
  IF NOT FOUND OR v_preview.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  PERFORM public.lock_receipt_key(v_actor, NULL);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('assignment-room-finalize:' || p_room_id::text, 0)
  );

  SELECT * INTO v_preview
  FROM public.assignment_rooms
  WHERE id = p_room_id;
  IF NOT FOUND OR v_preview.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  IF v_preview.status = 'finalized' THEN
    SELECT e.group_id INTO v_group_id
    FROM public.expenses e
    WHERE e.id = v_preview.expense_id
      AND e.client_id = p_room_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
    END IF;
  ELSIF v_preview.group_target->>'kind' = 'existing' THEN
    v_group_id := (v_preview.group_target->>'groupId')::uuid;
  ELSE
    v_group_result := public.create_group(
      v_preview.group_target->>'name',
      ARRAY[]::uuid[]
    );
    v_group_id := (v_group_result->>'groupId')::uuid;
  END IF;

  PERFORM public.lock_group(v_group_id);
  PERFORM public.assert_member(v_group_id, v_actor);

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id
  FOR UPDATE;
  IF NOT FOUND OR v_room.host_user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  SELECT id INTO v_host_participant_id
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id
    AND user_id = v_actor
    AND removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_host_required';
  END IF;

  IF v_room.status = 'finalized' THEN
    SELECT e.id, e.group_id, e.status, e.current_version_no, g.ledger_version
    INTO v_expense_id, v_existing_group_id, v_existing_status,
         v_existing_version, v_ledger_version
    FROM public.expenses e
    JOIN public.groups g ON g.id = e.group_id
    WHERE e.id = v_room.expense_id
      AND e.client_id = p_room_id
      AND e.group_id = v_group_id;
    IF NOT FOUND OR v_existing_status = 'deleted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
    END IF;
    v_ack := jsonb_build_object(
      'expenseId', v_expense_id,
      'groupId', v_group_id,
      'versionNo', v_existing_version,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
    RETURN jsonb_build_object(
      'room', public.assignment_room_view(
        p_room_id, v_host_participant_id, true
      ),
      'ack', v_ack
    );
  END IF;
  IF v_room.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_cancelled';
  END IF;
  IF v_room.status <> 'closed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;
  IF v_room.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_version';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.assignment_room_items i
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(c.ticks), 0) AS claimed_ticks
      FROM public.assignment_room_claims c
      JOIN public.assignment_room_participants p
        ON p.room_id = c.room_id AND p.id = c.participant_id
      WHERE c.room_id = i.room_id
        AND c.item_id = i.id
        AND p.removed_at IS NULL
    ) claims ON true
    WHERE i.room_id = p_room_id
      AND claims.claimed_ticks <> i.quantity_milliunits::bigint * 120
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;

  SELECT id INTO v_existing_client_expense
  FROM public.expenses
  WHERE client_id = p_room_id;
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;

  SELECT sum(total_price_cents)::bigint INTO v_subtotal
  FROM public.assignment_room_items
  WHERE room_id = p_room_id;
  v_service_fee := floor((v_subtotal::numeric
    * (v_room.header->>'serviceFeeBasisPoints')::integer + 5000) / 10000);
  v_total := v_subtotal + v_service_fee
    + (v_room.header->>'fixedFeeCents')::integer;

  v_validated_payload := public.validate_expense_payload(
    p_payload,
    'itemized',
    v_total::integer,
    (v_room.header->>'serviceFeeBasisPoints')::integer,
    (v_room.header->>'fixedFeeCents')::integer
  );

  -- Everyone who joined with an account keeps their ledger identity, so each
  -- one needs a group invitation before `assignment_room_expense_payload`
  -- classifies them as a user rather than a guest. `invite_member` owns the
  -- membership, exclusion and event rules; it is a no-op for people already
  -- in the group, and the group lock is already held.
  FOR v_participant_user_id IN
    SELECT DISTINCT p.user_id
    FROM public.assignment_room_participants p
    WHERE p.room_id = p_room_id
      AND p.removed_at IS NULL
      AND p.user_id IS NOT NULL
    ORDER BY p.user_id
  LOOP
    IF NOT public.is_member_or_invited(v_group_id, v_participant_user_id) THEN
      PERFORM public.invite_member(v_group_id, v_participant_user_id);
    END IF;
  END LOOP;

  v_expected_payload := public.assignment_room_expense_payload(
    p_room_id,
    v_group_id,
    v_validated_payload->'payers'
  );
  IF v_validated_payload IS DISTINCT FROM v_expected_payload THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  v_ack := public.create_expense(
    p_room_id,
    v_group_id,
    (v_room.header->>'occurredOn')::date,
    v_room.header->>'title',
    NULL,
    'itemized',
    v_total::integer,
    (v_room.header->>'serviceFeeBasisPoints')::integer,
    (v_room.header->>'fixedFeeCents')::integer,
    v_validated_payload,
    NULL
  );
  v_expense_id := (v_ack->>'expenseId')::uuid;

  UPDATE public.assignment_room_participants p
  SET expense_participant_index = indexed.participant_index
  FROM (
    SELECT id,
           (row_number() OVER (ORDER BY ordinal) - 1)::integer AS participant_index
    FROM public.assignment_room_participants
    WHERE room_id = p_room_id AND removed_at IS NULL
  ) indexed
  WHERE p.room_id = p_room_id AND p.id = indexed.id;

  UPDATE public.assignment_rooms
  SET expense_id = v_expense_id,
      status = 'finalized',
      revision = revision + 1
  WHERE id = p_room_id;

  PERFORM public.broadcast_assignment_room(p_room_id);
  RETURN jsonb_build_object(
    'room', public.assignment_room_view(
      p_room_id, v_host_participant_id, true
    ),
    'ack', v_ack
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_assignment_room(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_assignment_room_participant(uuid, uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_assignment_room(uuid, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.join_assignment_room(uuid, text, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_assignment_room_participant(uuid, uuid, bigint, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_assignment_room(uuid, bigint, jsonb)
  TO authenticated;
