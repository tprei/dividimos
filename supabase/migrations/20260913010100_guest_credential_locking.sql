-- Linearize guest credentials with claims (P4 / amended plan S2). Closes the
-- race where claim_guest read the credential before lock_group, allowing a concurrent
-- revoke or rotate to commit while claim waited on group lock and be ignored.
-- Linearizes lock acquisition order across create_guest_claim_token,
-- revoke_guest_claim_token, and claim_guest: Group -> (Guest, Expense) -> Credential.
-- Under group and guest locks, claim_guest re-reads and locks the credential row
-- FOR UPDATE by (guest_id, token_digest) and checks freshness against clock_timestamp().

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_guest_claim_token(p_guest_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
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

  INSERT INTO guest_credentials.claim_tokens AS ct (guest_id, token_digest, generation, expires_at, created_at)
  VALUES (p_guest_id, v_digest, 1, v_expires_at, now())
  ON CONFLICT (guest_id)
  DO UPDATE SET token_digest = EXCLUDED.token_digest,
                generation = ct.generation + 1,
                expires_at = EXCLUDED.expires_at,
                created_at = now();

  RETURN jsonb_build_object('token', v_token, 'expiresAt', to_jsonb(v_expires_at));
END;
$$;

REVOKE ALL ON FUNCTION public.create_guest_claim_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.create_guest_claim_token(uuid) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.revoke_guest_claim_token(p_guest_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_guest RECORD;
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

  SELECT g.id, e.group_id
  INTO v_guest
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id
  FOR UPDATE OF g, e;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  PERFORM assert_member(v_guest.group_id, v_actor);

  DELETE FROM guest_credentials.claim_tokens WHERE guest_id = p_guest_id;

  RETURN jsonb_build_object('guestId', p_guest_id);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_guest_claim_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_guest_claim_token(uuid) TO authenticated;
