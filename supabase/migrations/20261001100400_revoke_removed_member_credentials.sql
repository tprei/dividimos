-- Closing the removed-member side door: removing a member (or a member
-- leaving) used to leave every invite link and guest claim token that
-- member had created for the group fully live, so a sockpuppet account
-- could still join through the departed member's link or claim a guest
-- through their token. Departures now deactivate the departing member's
-- active invite links and delete their unclaimed guest claim tokens.
--
-- Existing claim_tokens rows cannot be attributed to a creator, so
-- created_by is added nullable with no default and no backfill: an
-- unattributed token keeps its existing expiry and revocation semantics.

SET lock_timeout = '5s';

ALTER TABLE guest_credentials.claim_tokens
  ADD COLUMN created_by uuid REFERENCES public.users(id);

COMMENT ON COLUMN guest_credentials.claim_tokens.created_by IS
  'Member who minted the token; NULL for tokens minted before attribution existed, which keep their existing expiry and revocation semantics.';

CREATE OR REPLACE FUNCTION public.create_guest_claim_token(p_guest_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_guest RECORD;
  v_bytes bytea;
  v_token text;
  v_digest bytea;
  v_expires_at timestamptz;
BEGIN
  v_actor := current_user_id();

  IF p_guest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  SELECT e.group_id
  INTO v_group_id
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  PERFORM lock_group(v_group_id);

  SELECT g.id, g.claimed_by, e.group_id
  INTO v_guest
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id
  FOR UPDATE OF g, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  PERFORM assert_member(v_guest.group_id, v_actor);

  IF v_guest.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_already_claimed';
  END IF;

  v_expires_at := now() + interval '7 days';
  v_bytes := extensions.gen_random_bytes(32);
  v_token := 'gst1_' || rtrim(translate(encode(v_bytes, 'base64'), '+/', '-_'), '=');
  v_digest := extensions.digest(convert_to(v_token, 'utf8'), 'sha256');

  INSERT INTO guest_credentials.claim_tokens AS ct (guest_id, token_digest, generation, expires_at, created_at, created_by)
  VALUES (p_guest_id, v_digest, 1, v_expires_at, now(), v_actor)
  ON CONFLICT (guest_id)
  DO UPDATE SET token_digest = EXCLUDED.token_digest,
                generation = ct.generation + 1,
                expires_at = EXCLUDED.expires_at,
                created_at = now(),
                created_by = EXCLUDED.created_by;

  RETURN jsonb_build_object('token', v_token, 'expiresAt', to_jsonb(v_expires_at));
END;
$$;

REVOKE ALL ON FUNCTION public.create_guest_claim_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.create_guest_claim_token(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_kind group_kind;
  v_ledger_version bigint;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT kind, ledger_version INTO v_kind, v_ledger_version FROM groups WHERE id = p_group_id;
  IF v_kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cannot_leave_dm';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_balances
    WHERE group_id = p_group_id AND kind = 'user' AND participant_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'outstanding_balance';
  END IF;

  DELETE FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor;

  INSERT INTO group_member_departures (group_id, user_id, departed_at)
  VALUES (p_group_id, v_actor, now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET departed_at = EXCLUDED.departed_at;

  UPDATE public.group_invite_links
  SET is_active = false
  WHERE group_id = p_group_id AND created_by = v_actor AND is_active;

  DELETE FROM guest_credentials.claim_tokens ct
  USING public.guests g, public.expenses e
  WHERE ct.created_by = v_actor
    AND ct.guest_id = g.id
    AND g.expense_id = e.id
    AND e.group_id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'member_left',
    v_actor,
    p_subject_user_id => v_actor,
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

REVOKE ALL ON FUNCTION public.leave_group(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_member(p_group_id uuid, p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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

  INSERT INTO group_member_exclusions (group_id, user_id, excluded_by, excluded_at)
  VALUES (p_group_id, p_user_id, v_actor, now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET excluded_by = EXCLUDED.excluded_by,
                excluded_at = EXCLUDED.excluded_at;

  INSERT INTO group_member_departures (group_id, user_id, departed_at)
  VALUES (p_group_id, p_user_id, now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET departed_at = EXCLUDED.departed_at;

  UPDATE public.group_invite_links
  SET is_active = false
  WHERE group_id = p_group_id AND created_by = p_user_id AND is_active;

  DELETE FROM guest_credentials.claim_tokens ct
  USING public.guests g, public.expenses e
  WHERE ct.created_by = p_user_id
    AND ct.guest_id = g.id
    AND g.expense_id = e.id
    AND e.group_id = p_group_id;

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

REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;
