CREATE FUNCTION public.issue_guest_claim_token(p_guest_id uuid)
RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_guest RECORD;
  v_bytes bytea;
  v_token text;
  v_digest bytea;
BEGIN
  v_actor := current_user_id();

  IF p_guest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  SELECT g.id, g.claimed_by, e.group_id
  INTO v_guest
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = p_guest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_not_found';
  END IF;

  PERFORM assert_member(v_guest.group_id, v_actor);

  IF v_guest.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_already_claimed';
  END IF;

  v_bytes := extensions.gen_random_bytes(32);
  v_token := rtrim(translate(encode(v_bytes, 'base64'), '+/', '-_'), '=');
  v_digest := extensions.digest(convert_to(v_token, 'utf8'), 'sha256');

  INSERT INTO guest_credentials.claim_tokens AS ct (guest_id, token_digest, generation, created_at)
  VALUES (p_guest_id, v_digest, 1, now())
  ON CONFLICT (guest_id)
  DO UPDATE SET token_digest = EXCLUDED.token_digest,
                generation = ct.generation + 1,
                created_at = now();

  RETURN v_token;
END;
$$;

CREATE FUNCTION public.resolve_guest_claim_token(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_digest bytea;
  v_rec RECORD;
  v_status text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object(
      'guestId', NULL,
      'displayName', NULL,
      'expenseTitle', NULL,
      'groupName', NULL,
      'shareCents', NULL,
      'status', 'not_found'
    );
  END IF;

  v_digest := extensions.digest(convert_to(p_token, 'utf8'), 'sha256');

  SELECT
    g.id AS guest_id,
    g.display_name,
    g.claimed_by,
    ev.title AS expense_title,
    grp.name AS group_name,
    COALESCE(ep.share_cents, 0) AS share_cents
  INTO v_rec
  FROM guest_credentials.claim_tokens ct
  JOIN guests g ON g.id = ct.guest_id
  JOIN expenses e ON e.id = g.expense_id
  JOIN expense_versions ev ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
  JOIN groups grp ON grp.id = e.group_id
  LEFT JOIN expense_participants ep ON ep.expense_id = e.id AND ep.guest_id = g.id
  WHERE ct.token_digest = v_digest;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'guestId', NULL,
      'displayName', NULL,
      'expenseTitle', NULL,
      'groupName', NULL,
      'shareCents', NULL,
      'status', 'not_found'
    );
  END IF;

  IF v_rec.claimed_by IS NOT NULL THEN
    v_status := 'already_claimed';
  ELSE
    v_status := 'ready';
  END IF;

  RETURN jsonb_build_object(
    'guestId', v_rec.guest_id,
    'displayName', v_rec.display_name,
    'expenseTitle', v_rec.expense_title,
    'groupName', v_rec.group_name,
    'shareCents', v_rec.share_cents,
    'status', v_status
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'guestId', NULL,
    'displayName', NULL,
    'expenseTitle', NULL,
    'groupName', NULL,
    'shareCents', NULL,
    'status', 'not_found'
  );
END;
$$;

CREATE FUNCTION public.claim_guest(p_token text)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_digest bytea;
  v_rec RECORD;
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

  SELECT ct.guest_id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM guest_credentials.claim_tokens ct
  JOIN guests g ON g.id = ct.guest_id
  JOIN expenses e ON e.id = g.expense_id
  WHERE ct.token_digest = v_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_token';
  END IF;

  PERFORM lock_group(v_rec.group_id);

  SELECT g.id, g.expense_id, g.display_name, g.claimed_by, e.group_id, e.status AS expense_status, e.current_version_no
  INTO v_rec
  FROM guests g
  JOIN expenses e ON e.id = g.expense_id
  WHERE g.id = v_rec.guest_id
  FOR UPDATE OF g, e;

  IF v_rec.claimed_by IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'already_claimed';
  END IF;

  IF v_rec.expense_status = 'deleted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'expense_deleted';
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

REVOKE ALL ON FUNCTION public.issue_guest_claim_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.issue_guest_claim_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_guest_claim_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_guest_claim_token(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_guest(text) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_guest(text) TO authenticated;
