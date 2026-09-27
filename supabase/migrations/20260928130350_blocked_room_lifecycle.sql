-- a blocked pair joins a room unlinked and finalizes as a guest slot, mirrored only in the host's room view so other viewers never learn about the block

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
    IF NOT public.is_member_or_invited(v_group_id, v_participant_user_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.user_blocks b
         WHERE (b.blocker_id = v_actor AND b.blocked_id = v_participant_user_id)
            OR (b.blocker_id = v_participant_user_id AND b.blocked_id = v_actor)
       ) THEN
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

REVOKE ALL ON FUNCTION public.finalize_assignment_room(uuid, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_assignment_room(uuid, bigint, jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.assignment_room_view(
  p_room_id uuid,
  p_self_participant_id uuid,
  p_host boolean
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_room public.assignment_rooms%ROWTYPE;
  v_snapshot jsonb;
  v_view jsonb;
  v_subtotal bigint;
  v_total bigint;
BEGIN
  SELECT * INTO v_room FROM public.assignment_rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_not_found';
  END IF;

  SELECT COALESCE(sum(total_price_cents), 0) INTO v_subtotal
  FROM public.assignment_room_items WHERE room_id = p_room_id;
  v_total := v_subtotal
    + floor((v_subtotal::numeric * (v_room.header->>'serviceFeeBasisPoints')::integer + 5000) / 10000)
    + (v_room.header->>'fixedFeeCents')::integer;

  v_snapshot := jsonb_build_object(
    'id', v_room.id,
    'revision', v_room.revision,
    'status', v_room.status,
    'title', v_room.header->>'title',
    'occurredOn', v_room.header->>'occurredOn',
    'serviceFeeBasisPoints', (v_room.header->>'serviceFeeBasisPoints')::integer,
    'fixedFeeCents', (v_room.header->>'fixedFeeCents')::integer,
    'totalCents', v_total,
    'selfParticipantId', p_self_participant_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id,
        'ordinal', i.ordinal,
        'revision', i.revision,
        'description', i.description,
        'quantityMilliunits', i.quantity_milliunits,
        'unitPriceCents', i.unit_price_cents,
        'totalPriceCents', i.total_price_cents
      ) || CASE WHEN i.icon IS NULL
            THEN '{}'::jsonb
            ELSE jsonb_build_object('icon', i.icon)
          END
      ORDER BY i.ordinal)
      FROM public.assignment_room_items i WHERE i.room_id = p_room_id
    ), '[]'::jsonb),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'ordinal', p.ordinal,
        'displayName', p.display_name,
        'avatarUrl', u.avatar_url,
        'isGuest', p.user_id IS NULL OR (p_host AND EXISTS (
          SELECT 1 FROM public.user_blocks b
          WHERE (b.blocker_id = p.user_id AND b.blocked_id = v_room.host_user_id)
             OR (b.blocker_id = v_room.host_user_id AND b.blocked_id = p.user_id)
        )),
        'removed', p.removed_at IS NOT NULL
      ) ORDER BY p.ordinal)
      FROM public.assignment_room_participants p
      LEFT JOIN public.users u ON u.id = p.user_id
      WHERE p.room_id = p_room_id
    ), '[]'::jsonb),
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'itemId', c.item_id,
        'participantId', c.participant_id,
        'ticks', c.ticks
      ) ORDER BY i.ordinal, p.ordinal)
      FROM public.assignment_room_claims c
      JOIN public.assignment_room_items i ON i.room_id = c.room_id AND i.id = c.item_id
      JOIN public.assignment_room_participants p ON p.room_id = c.room_id AND p.id = c.participant_id
      WHERE c.room_id = p_room_id
    ), '[]'::jsonb),
    'topic', (SELECT a.broadcast_topic FROM guest_credentials.assignment_room_access a WHERE a.room_id = p_room_id),
    'currentBill', CASE WHEN v_room.expense_id IS NULL THEN NULL
      ELSE public.assignment_room_bill_breakdown(v_room.expense_id) END
  );

  IF NOT p_host THEN
    RETURN jsonb_build_object('role', 'participant', 'room', v_snapshot);
  END IF;

  v_view := jsonb_build_object(
    'role', 'host',
    'room', v_snapshot,
    'groupTarget', v_room.group_target,
    'participantRefs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'participantId', p.id,
        'ref', CASE WHEN p.user_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.user_blocks b
            WHERE (b.blocker_id = p.user_id AND b.blocked_id = v_room.host_user_id)
               OR (b.blocker_id = v_room.host_user_id AND b.blocked_id = p.user_id)
          )
          THEN jsonb_build_object('kind', 'user', 'userId', p.user_id)
          ELSE jsonb_build_object('kind', 'guest', 'guestId', NULL, 'displayName', p.display_name)
        END
      ) ORDER BY p.ordinal)
      FROM public.assignment_room_participants p
      WHERE p.room_id = p_room_id
    ), '[]'::jsonb)
  );
  RETURN v_view;
END;
$$;

REVOKE ALL ON FUNCTION public.assignment_room_view(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assignment_room_view(uuid, uuid, boolean) TO service_role;
