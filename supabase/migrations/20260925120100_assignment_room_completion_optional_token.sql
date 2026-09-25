-- get_assignment_room_completion already accepts a null member token for hosts,
-- but its signature did not say so, so the generated client types demanded a
-- string and TypeScript callers had to lie with casts to pass null. State
-- the default in the signature: the argument types stay (uuid, text), so
-- installed clients sending an explicit null keep working unchanged.
CREATE OR REPLACE FUNCTION public.get_assignment_room_completion(
  p_room_id uuid,
  p_member_token text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, guest_credentials, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_view jsonb;
  v_self_participant_id uuid;
  v_room public.assignment_rooms%ROWTYPE;
  v_expense public.expenses%ROWTYPE;
  v_original_index integer;
  v_original_ref jsonb;
  -- Stable identity resolved from the version-1 ref; a claimed guest keeps
  -- both set, an unclaimed guest only the guest id.
  v_identity_user uuid;
  v_identity_guest uuid;
  v_guest_unclaimed boolean := false;
  v_participants jsonb;
  v_p jsonb;
  v_n integer;
  v_i integer;
  v_self_index integer;
  v_actor_is_participant boolean := false;
  v_identity_matches boolean := false;
  v_member_status text;
  v_excluded boolean := false;
  v_claim_eligible boolean := false;
  v_action jsonb;
BEGIN
  -- Authorize through the existing room read; its stable errors are the
  -- contract. The self participant comes from the returned snapshot.
  v_view := public.get_assignment_room(p_room_id, p_member_token);
  v_self_participant_id := (v_view->'room'->>'selfParticipantId')::uuid;

  SELECT * INTO v_room
  FROM public.assignment_rooms
  WHERE id = p_room_id;
  IF v_room.status <> 'finalized' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;

  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = v_room.expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_incomplete';
  END IF;

  -- Original stable identity: this participant's slot in version 1 of the
  -- finalization payload. Guard the ref shape the same way the
  -- current_expense_participants view does.
  SELECT expense_participant_index INTO v_original_index
  FROM public.assignment_room_participants
  WHERE room_id = p_room_id AND id = v_self_participant_id;

  IF v_original_index IS NOT NULL THEN
    SELECT payload->'participants'->v_original_index INTO v_original_ref
    FROM public.expense_versions
    WHERE expense_id = v_room.expense_id AND version_no = 1;

    IF v_original_ref IS NOT NULL AND v_original_ref->>'kind' = 'user'
       AND v_original_ref ? 'userId'
       AND (v_original_ref->>'userId') ~ '^[0-9a-fA-F-]{36}$' THEN
      v_identity_user := (v_original_ref->>'userId')::uuid;
    ELSIF v_original_ref IS NOT NULL AND v_original_ref->>'kind' = 'guest'
       AND v_original_ref ? 'guestId'
       AND (v_original_ref->>'guestId') ~ '^[0-9a-fA-F-]{36}$' THEN
      v_identity_guest := (v_original_ref->>'guestId')::uuid;
      SELECT claimed_by INTO v_identity_user
      FROM public.guests
      WHERE id = v_identity_guest AND expense_id = v_room.expense_id;
      v_guest_unclaimed := FOUND AND v_identity_user IS NULL;
    END IF;
  END IF;

  -- Resolve the stable identity against the current effective payload, which
  -- already substitutes a claimed guest with its owner. Deleted bills render
  -- empty participant arrays, so no current index can honestly exist.
  IF v_expense.status = 'active'
     AND (v_identity_user IS NOT NULL OR v_identity_guest IS NOT NULL) THEN
    v_participants := COALESCE(
      public.effective_expense_payload(
        v_room.expense_id, v_expense.current_version_no
      )->'participants',
      '[]'::jsonb
    );
    IF jsonb_typeof(v_participants) = 'array' THEN
      v_n := jsonb_array_length(v_participants);
      v_i := 0;
      WHILE v_i < v_n LOOP
        v_p := v_participants->v_i;
        IF v_self_index IS NULL THEN
          IF v_identity_user IS NOT NULL
             AND v_p->>'kind' = 'user'
             AND v_p->>'userId' = v_identity_user::text THEN
            v_self_index := v_i;
          ELSIF v_identity_user IS NULL
             AND v_identity_guest IS NOT NULL
             AND v_p->>'kind' = 'guest'
             AND v_p->>'guestId' = v_identity_guest::text THEN
            v_self_index := v_i;
          END IF;
        END IF;
        IF v_actor IS NOT NULL AND NOT v_actor_is_participant
           AND v_p->>'kind' = 'user'
           AND v_p->>'userId' = v_actor::text THEN
          v_actor_is_participant := true;
        END IF;
        v_i := v_i + 1;
      END LOOP;
    END IF;
  END IF;

  -- Identity-authorized actions require the actor to be the participant's
  -- own stable account (or the guest owner who claimed it); the bearer token
  -- alone never grants account navigation for someone else.
  IF v_actor IS NOT NULL AND v_identity_user IS NOT NULL
     AND v_actor = v_identity_user THEN
    v_identity_matches := true;
    SELECT status INTO v_member_status
    FROM public.group_members
    WHERE group_id = v_expense.group_id AND user_id = v_actor;
    SELECT EXISTS (
      SELECT 1 FROM public.group_member_exclusions
      WHERE group_id = v_expense.group_id AND user_id = v_actor
    ) INTO v_excluded;
  END IF;

  -- Claim eligibility mirrors the existing claim_guest preconditions for an
  -- authenticated actor presenting an unclaimed guest's own bearer.
  IF v_actor IS NOT NULL AND NOT v_identity_matches
     AND v_expense.status = 'active'
     AND v_guest_unclaimed
     AND v_self_index IS NOT NULL
     AND NOT v_actor_is_participant
  THEN
    SELECT EXISTS (
      SELECT 1 FROM public.group_member_exclusions
      WHERE group_id = v_expense.group_id AND user_id = v_actor
    ) INTO v_excluded;
    v_claim_eligible := NOT v_excluded AND EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = v_expense.group_id
        AND NOT (
          g.kind = 'dm'
          AND v_actor IS DISTINCT FROM g.dm_user_a
          AND v_actor IS DISTINCT FROM g.dm_user_b
        )
    );
  END IF;

  IF v_identity_matches AND v_member_status = 'accepted' THEN
    v_action := jsonb_build_object(
      'kind', 'view_expense',
      'expenseId', v_room.expense_id,
      'groupId', v_expense.group_id
    );
  ELSIF v_identity_matches AND v_expense.status = 'active'
     AND v_member_status = 'invited' AND NOT v_excluded THEN
    v_action := jsonb_build_object(
      'kind', 'accept_invitation',
      'expenseId', v_room.expense_id,
      'groupId', v_expense.group_id
    );
  ELSIF v_claim_eligible THEN
    v_action := jsonb_build_object('kind', 'claim_guest');
  ELSIF v_actor IS NULL AND v_identity_guest IS NULL
     AND v_identity_user IS NOT NULL THEN
    -- Account participant reached anonymously: it needs its own account.
    v_action := jsonb_build_object('kind', 'sign_in');
  ELSIF v_actor IS NULL AND v_expense.status = 'active'
     AND v_guest_unclaimed AND v_self_index IS NOT NULL THEN
    -- Own still-current unclaimed guest share: sign-in is the first step of
    -- the explicit claim, never the claim itself.
    v_action := jsonb_build_object('kind', 'sign_in');
  ELSE
    v_action := jsonb_build_object('kind', 'unavailable');
  END IF;

  RETURN jsonb_build_object(
    'roomId', p_room_id,
    'bill', public.assignment_room_bill_breakdown(v_room.expense_id),
    'selfParticipantIndex', to_jsonb(v_self_index),
    'action', v_action
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_assignment_room_completion(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_assignment_room_completion(uuid, text)
  TO anon, authenticated;
