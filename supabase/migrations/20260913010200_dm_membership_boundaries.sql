-- Enforce canonical DM pair boundaries across membership paths and repair
-- existing DM memberships that violate the canonical pair (P5 part 1).
--
-- Helpers:
--   public.assert_dm_pair_allowed(p_group_id uuid, p_user_id uuid)
--
-- Callers updated:
--   invite_member: reject third-user invitations into DMs
--   join_via_link: reject joining a DM if actor is not an endpoint
--   claim_guest: reject claiming a guest in a DM if claimant is not an endpoint
--   materialize_participants: reject third-user participant resolution in DMs
--   remove_member: require actor's current accepted membership
--   delete_group: require actor's current accepted membership
--
-- One-time repair:
--   Deletes noncanonical group_members rows for kind='dm' groups.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.assert_dm_pair_allowed(p_group_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind group_kind;
  v_user_a uuid;
  v_user_b uuid;
BEGIN
  SELECT kind, dm_user_a, dm_user_b
  INTO v_kind, v_user_a, v_user_b
  FROM groups
  WHERE id = p_group_id;

  IF v_kind = 'dm' AND (p_user_id IS DISTINCT FROM v_user_a AND p_user_id IS DISTINCT FROM v_user_b) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_dm_pair_allowed(uuid, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.invite_member(p_group_id uuid, p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);
  PERFORM assert_dm_pair_allowed(p_group_id, p_user_id);

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  SELECT status INTO v_status FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id;
  IF FOUND THEN
    IF v_status = 'accepted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_member';
    ELSIF v_status = 'invited' THEN
      SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;
      RETURN jsonb_build_object(
        'groupId', p_group_id,
        'ledgerVersion', v_ledger_version,
        'eventId', NULL
      );
    END IF;
  END IF;

  INSERT INTO group_members (group_id, user_id, status, invited_by)
  VALUES (p_group_id, p_user_id, 'invited', v_actor);

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'member_invited',
    v_actor,
    p_subject_user_id => p_user_id,
    p_payload => jsonb_build_object('userIds', jsonb_build_array(p_user_id))
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
  PERFORM broadcast_user(p_user_id, p_group_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_via_link(p_token text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_link RECORD;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  SELECT * INTO v_link FROM group_invite_links WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  PERFORM lock_group(v_link.group_id);

  SELECT * INTO v_link FROM group_invite_links WHERE id = v_link.id FOR UPDATE;

  IF NOT v_link.is_active
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now())
     OR (v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_link';
  END IF;

  PERFORM assert_dm_pair_allowed(v_link.group_id, v_actor);

  SELECT status INTO v_status FROM group_members
  WHERE group_id = v_link.group_id AND user_id = v_actor
  FOR UPDATE;

  IF FOUND AND v_status = 'accepted' THEN
    SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_link.group_id;
    RETURN jsonb_build_object(
      'groupId', v_link.group_id,
      'ledgerVersion', v_ledger_version,
      'eventId', NULL
    );
  END IF;

  UPDATE group_invite_links
  SET use_count = use_count + 1
  WHERE id = v_link.id;

  IF FOUND AND v_status = 'invited' THEN
    UPDATE group_members
    SET status = 'accepted', accepted_at = now()
    WHERE group_id = v_link.group_id AND user_id = v_actor;
  ELSE
    INSERT INTO group_members (group_id, user_id, status, accepted_at)
    VALUES (v_link.group_id, v_actor, 'accepted', now());
  END IF;

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = v_link.group_id;

  v_event_id := emit_event(
    v_link.group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(v_link.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', v_link.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_via_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_via_link(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_member(p_group_id uuid, p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
  v_kind group_kind;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  SELECT creator_id, kind, ledger_version INTO v_creator_id, v_kind, v_ledger_version FROM groups WHERE id = p_group_id;
  IF v_creator_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_creator';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  IF p_user_id = v_creator_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
  END IF;

  IF v_kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cannot_leave_dm';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
  END IF;

  DELETE FROM group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  v_event_id := emit_event(
    p_group_id,
    'member_removed',
    v_actor,
    p_subject_user_id => p_user_id,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  SELECT creator_id INTO v_creator_id FROM groups WHERE id = p_group_id;
  IF v_creator_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_creator';
  END IF;

  PERFORM assert_member(p_group_id, v_actor);

  IF EXISTS (SELECT 1 FROM group_balances WHERE group_id = p_group_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
  END IF;

  IF (SELECT count(*) FROM group_members WHERE group_id = p_group_id) > 1
     AND (EXISTS (SELECT 1 FROM expenses WHERE group_id = p_group_id)
          OR EXISTS (SELECT 1 FROM settlements WHERE group_id = p_group_id)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_has_history';
  END IF;

  DELETE FROM groups WHERE id = p_group_id;

  RETURN jsonb_build_object('groupId', p_group_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.materialize_participants(p_expense_id uuid, p_author uuid, p_payload jsonb)
RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_participants jsonb;
  v_n integer;
  v_i integer;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_id uuid;
  v_new_guest_id uuid;
  v_display_name text;
  v_claimed_by uuid;
  v_share integer;
  v_paid integer;
  v_payers jsonb;
  v_j integer;
  v_payer jsonb;
  v_out_participants jsonb := '[]'::jsonb;
  v_out jsonb;
  v_seen_users uuid[] := '{}';
  v_current_version integer;
  v_prev_payload jsonb;
  v_existing_user_ids uuid[] := '{}';
BEGIN
  SELECT e.group_id, e.current_version_no INTO v_group_id, v_current_version
  FROM expenses e WHERE e.id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  SELECT payload INTO v_prev_payload FROM expense_versions
  WHERE expense_id = p_expense_id AND version_no = v_current_version;
  SELECT COALESCE(array_agg((pa.el->>'userId')::uuid), '{}') INTO v_existing_user_ids
  FROM jsonb_array_elements(COALESCE(v_prev_payload->'participants', '[]'::jsonb)) AS pa(el)
  WHERE pa.el->>'kind' = 'user' AND pa.el ? 'userId';

  v_participants := p_payload->'participants';
  v_n := jsonb_array_length(v_participants);
  v_payers := COALESCE(p_payload->'payers', '[]'::jsonb);

  DELETE FROM expense_participants WHERE expense_id = p_expense_id;

  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_user_id := NULL;
    v_guest_id := NULL;
    v_new_guest_id := NULL;
    v_claimed_by := NULL;
    v_display_name := NULL;
    IF v_participant->>'kind' = 'user' THEN
      v_user_id := (v_participant->>'userId')::uuid;
      PERFORM assert_dm_pair_allowed(v_group_id, v_user_id);
      IF NOT is_member_or_invited(v_group_id, v_user_id)
         AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
      END IF;
    ELSIF v_participant->>'kind' = 'guest' THEN
      v_display_name := v_participant->>'displayName';
      IF jsonb_typeof(v_participant->'guestId') = 'string' THEN
        v_guest_id := (v_participant->>'guestId')::uuid;
        SELECT id, claimed_by INTO v_new_guest_id, v_claimed_by
        FROM guests WHERE id = v_guest_id AND expense_id = p_expense_id;
        IF v_new_guest_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
        END IF;
      ELSE
        INSERT INTO guests (expense_id, display_name) VALUES (p_expense_id, v_display_name)
        RETURNING id INTO v_new_guest_id;
      END IF;
      IF v_claimed_by IS NOT NULL THEN
        v_guest_id := NULL;
        v_user_id := v_claimed_by;
        PERFORM assert_dm_pair_allowed(v_group_id, v_user_id);
        IF NOT is_member_or_invited(v_group_id, v_user_id)
           AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
        END IF;
      ELSE
        v_guest_id := v_new_guest_id;
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;

    IF v_user_id IS NOT NULL THEN
      IF v_user_id = ANY (v_seen_users) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
      END IF;
      v_seen_users := array_append(v_seen_users, v_user_id);
    END IF;

    v_share := (p_payload->'shares'->v_i)::integer;
    v_paid := 0;
    v_j := 0;
    WHILE v_j < jsonb_array_length(v_payers) LOOP
      v_payer := v_payers->v_j;
      IF (v_payer->>'participantIndex')::integer = v_i THEN
        v_paid := v_paid + (v_payer->>'amountCents')::integer;
      END IF;
      v_j := v_j + 1;
    END LOOP;

    INSERT INTO expense_participants (expense_id, participant_index, kind, user_id, guest_id, share_cents, paid_cents)
    VALUES (
      p_expense_id, v_i,
      CASE WHEN v_user_id IS NOT NULL THEN 'user'::participant_kind ELSE 'guest'::participant_kind END,
      v_user_id, v_guest_id, v_share, v_paid
    );

    IF v_user_id IS NOT NULL THEN
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'user', 'userId', v_user_id);
    ELSE
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'guest', 'guestId', v_guest_id, 'displayName', v_display_name);
    END IF;
    v_i := v_i + 1;
  END LOOP;

  -- An unclaimed guest with no participant slot left is unreachable; its
  -- claim token would otherwise still redeem into group membership.
  DELETE FROM guests g
  WHERE g.expense_id = p_expense_id
    AND g.claimed_by IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM expense_participants ep
      WHERE ep.expense_id = p_expense_id AND ep.guest_id = g.id
    );

  v_out := jsonb_set(p_payload, '{participants}', v_out_participants);
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_participants(uuid, uuid, jsonb) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_guest(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_digest bytea;
  v_group_id uuid;
  v_guest_id uuid;
  v_rec RECORD;
  v_cred RECORD;
  v_payload jsonb;
  v_new_participants jsonb;
  v_new_payload jsonb;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'utf8'), 'sha256');

  SELECT ct.guest_id, e.group_id
  INTO v_guest_id, v_group_id
  FROM guest_credentials.claim_tokens ct
  JOIN guests g ON g.id = ct.guest_id
  JOIN expenses e ON e.id = g.expense_id
  WHERE ct.token_digest = v_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  PERFORM lock_group(v_group_id);

  SELECT g.id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = v_guest_id
  FOR UPDATE OF g, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  SELECT ct.guest_id, ct.expires_at
  INTO v_cred
  FROM guest_credentials.claim_tokens ct
  WHERE ct.guest_id = v_rec.id AND ct.token_digest = v_digest
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_cred.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_claimed';
  END IF;

  IF v_rec.expense_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
  END IF;

  -- A guest dropped by a later edit keeps its row but no participant slot;
  -- redeeming that orphaned token would hand group membership to a stranger.
  IF NOT EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM expense_participants
    WHERE expense_id = v_rec.expense_id AND user_id = v_actor AND kind = 'user'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_participant';
  END IF;

  PERFORM assert_dm_pair_allowed(v_rec.group_id, v_actor);

  UPDATE guests
  SET claimed_by = v_actor,
      claimed_at = now()
  WHERE id = v_rec.id;

  UPDATE expense_participants
  SET kind = 'user',
      user_id = v_actor,
      guest_id = NULL
  WHERE expense_id = v_rec.expense_id AND guest_id = v_rec.id;

  SELECT payload INTO v_payload
  FROM expense_versions
  WHERE expense_id = v_rec.expense_id AND version_no = v_rec.current_version_no;

  SELECT jsonb_agg(
    CASE
      WHEN p->>'kind' = 'guest' AND p->>'guestId' = v_rec.id::text
      THEN jsonb_build_object('kind', 'user', 'userId', v_actor)
      ELSE p
    END
    ORDER BY ord
  )
  INTO v_new_participants
  FROM jsonb_array_elements(v_payload->'participants') WITH ORDINALITY AS t(p, ord);

  v_new_payload := jsonb_set(v_payload, '{participants}', v_new_participants);

  UPDATE expense_versions
  SET payload = v_new_payload
  WHERE expense_id = v_rec.expense_id AND version_no = v_rec.current_version_no;

  INSERT INTO group_members (group_id, user_id, status, accepted_at)
  VALUES (v_rec.group_id, v_actor, 'accepted', now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = 'accepted', accepted_at = COALESCE(group_members.accepted_at, now());

  v_ledger_version := recompute_group_balances(v_rec.group_id);

  v_event_id := emit_event(
    p_group_id => v_rec.group_id,
    p_kind => 'guest_claimed',
    p_actor => v_actor,
    p_expense_id => v_rec.expense_id,
    p_settlement_id => NULL,
    p_subject_user_id => v_actor,
    p_payload => jsonb_build_object('displayName', v_rec.display_name)
  );

  PERFORM broadcast_group(v_rec.group_id, v_ledger_version, v_event_id);

  RETURN jsonb_build_object(
    'expenseId', v_rec.expense_id,
    'groupId', v_rec.group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest(text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_guest(text) TO authenticated;

-- Messages, events, expense headers/version payloads, settlements, and
-- balances are deliberately untouched — membership repair must not rewrite
-- financial facts.
DELETE FROM public.group_members gm
USING public.groups g
WHERE gm.group_id = g.id
  AND g.kind = 'dm'
  AND gm.user_id IS DISTINCT FROM g.dm_user_a
  AND gm.user_id IS DISTINCT FROM g.dm_user_b;
