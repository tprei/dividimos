CREATE FUNCTION public.create_group(p_name text, p_member_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_name text;
  v_clean_member_ids uuid[];
  v_group_id uuid;
  v_ledger_version bigint;
  v_event_id bigint;
  v_subject_user_id uuid;
BEGIN
  v_actor := current_user_id();

  v_name := btrim(p_name);
  IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT u ORDER BY u), ARRAY[]::uuid[])
  INTO v_clean_member_ids
  FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) AS u
  WHERE u <> v_actor;

  IF COALESCE(array_length(v_clean_member_ids, 1), 0) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM unnest(v_clean_member_ids) AS u
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = u)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
    END IF;
  END IF;

  INSERT INTO groups (kind, name, creator_id)
  VALUES ('group', v_name, v_actor)
  RETURNING id, ledger_version INTO v_group_id, v_ledger_version;

  INSERT INTO group_members (group_id, user_id, status, accepted_at)
  VALUES (v_group_id, v_actor, 'accepted', now());

  IF COALESCE(array_length(v_clean_member_ids, 1), 0) > 0 THEN
    INSERT INTO group_members (group_id, user_id, status, invited_by)
    SELECT v_group_id, u, 'invited', v_actor
    FROM unnest(v_clean_member_ids) AS u;

    v_subject_user_id := CASE WHEN array_length(v_clean_member_ids, 1) = 1 THEN v_clean_member_ids[1] ELSE NULL END;
    v_event_id := emit_event(
      v_group_id,
      'member_invited',
      v_actor,
      p_subject_user_id => v_subject_user_id,
      p_payload => jsonb_build_object('userIds', to_jsonb(v_clean_member_ids))
    );
    PERFORM broadcast_group(v_group_id, v_ledger_version, v_event_id);
    PERFORM broadcast_user(u, v_group_id) FROM unnest(v_clean_member_ids) AS u;
  ELSE
    v_event_id := NULL;
  END IF;

  RETURN jsonb_build_object(
    'groupId', v_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.assert_dm_pair_allowed(p_group_id uuid, p_user_id uuid) RETURNS void
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

CREATE FUNCTION public.invite_member(p_group_id uuid, p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
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

  SELECT creator_id, ledger_version INTO v_creator_id, v_ledger_version FROM groups WHERE id = p_group_id;

  IF EXISTS (SELECT 1 FROM group_member_exclusions WHERE group_id = p_group_id AND user_id = p_user_id) THEN
    IF v_actor = v_creator_id THEN
      DELETE FROM group_member_exclusions WHERE group_id = p_group_id AND user_id = p_user_id;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
    END IF;
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

CREATE FUNCTION public.accept_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_event_id bigint;
  v_invited_by uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = p_group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  UPDATE group_members
  SET status = 'accepted', accepted_at = now()
  WHERE group_id = p_group_id AND user_id = v_actor;

  -- Shared-history latch: joining a group whose facts already exist makes
  -- them shared from this moment.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = p_group_id
    AND financial_history_shared_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.expenses WHERE group_id = p_group_id)
         OR EXISTS (SELECT 1 FROM public.settlements WHERE group_id = p_group_id));

  SELECT ledger_version INTO v_ledger_version FROM groups WHERE id = p_group_id;

  v_event_id := emit_event(
    p_group_id,
    'member_joined',
    v_actor,
    p_subject_user_id => v_actor,
    p_payload => '{}'::jsonb
  );

  PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
  IF v_invited_by IS NOT NULL THEN
    PERFORM broadcast_user(v_invited_by, p_group_id);
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;


CREATE FUNCTION public.decline_invitation(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_status member_status;
  v_ledger_version bigint;
  v_invited_by uuid;
  v_kind group_kind;
  v_event_id bigint;
  v_invalidated boolean := false;
  v_rec record;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = p_group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

  SELECT status, invited_by INTO v_status, v_invited_by FROM group_members
  WHERE group_id = p_group_id AND user_id = v_actor
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'invited' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_invited';
  END IF;

  SELECT kind, ledger_version INTO v_kind, v_ledger_version FROM groups WHERE id = p_group_id;

  IF v_kind = 'dm' THEN
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
    DELETE FROM groups WHERE id = p_group_id;
  ELSE
    FOR v_rec IN
      SELECT
        e.id AS expense_id,
        e.status AS expense_status,
        e.declined_user_ids,
        ev.title,
        ev.total_cents
      FROM expenses e
      JOIN expense_versions ev
        ON ev.expense_id = e.id AND ev.version_no = e.current_version_no
      WHERE e.group_id = p_group_id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(effective_expense_payload(e.id, e.current_version_no)->'participants', '[]'::jsonb)) AS pp(p)
          WHERE pp.p->>'kind' = 'user'
            AND pp.p ? 'userId'
            AND pp.p->>'userId' = v_actor::text
        )
      FOR UPDATE OF e
    LOOP
      IF v_rec.expense_status = 'active' THEN
        UPDATE expenses
        SET status = 'deleted',
            deleted_at = now(),
            deleted_by = v_actor,
            declined_user_ids = CASE
              WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
              ELSE array_append(declined_user_ids, v_actor)
            END
        WHERE id = v_rec.expense_id;


        v_event_id := emit_event(
          p_group_id, 'expense_deleted', v_actor, v_rec.expense_id,
          NULL, NULL, jsonb_build_object('title', v_rec.title, 'totalCents', v_rec.total_cents)
        );
        v_invalidated := true;
      ELSE
        UPDATE expenses
        SET declined_user_ids = CASE
              WHEN v_actor = ANY(declined_user_ids) THEN declined_user_ids
              ELSE array_append(declined_user_ids, v_actor)
            END
        WHERE id = v_rec.expense_id;
      END IF;
    END LOOP;

    IF v_invalidated THEN
      v_ledger_version := recompute_group_balances(p_group_id);
      PERFORM broadcast_group(p_group_id, v_ledger_version, v_event_id);
    END IF;

    DELETE FROM group_members
    WHERE group_id = p_group_id AND user_id = v_actor;
    IF v_invited_by IS NOT NULL THEN
      PERFORM broadcast_user(v_invited_by, p_group_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id
  );
END;
$$;

CREATE FUNCTION public.leave_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

CREATE FUNCTION public.remove_member(p_group_id uuid, p_user_id uuid) RETURNS jsonb
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

  INSERT INTO group_member_exclusions (group_id, user_id, excluded_by, excluded_at)
  VALUES (p_group_id, p_user_id, v_actor, now())
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET excluded_by = EXCLUDED.excluded_by,
                excluded_at = EXCLUDED.excluded_at;

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

CREATE FUNCTION public.delete_group(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_creator_id uuid;
  v_shared_at timestamptz;
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

  -- The latch remembers that financial history was shared even when every
  -- witness has since departed; current membership alone cannot measure it.
  SELECT financial_history_shared_at INTO v_shared_at
  FROM groups WHERE id = p_group_id;
  IF v_shared_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_has_history';
  END IF;

  DELETE FROM groups WHERE id = p_group_id;

  RETURN jsonb_build_object('groupId', p_group_id);
END;
$$;


CREATE FUNCTION public.get_or_create_dm(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_group_id uuid;
  v_ledger_version bigint;
  v_created boolean;
  v_event_id bigint;
BEGIN
  v_actor := current_user_id();

  IF p_user_id IS NULL OR p_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  v_user_a := LEAST(v_actor, p_user_id);
  v_user_b := GREATEST(v_actor, p_user_id);

  INSERT INTO groups (kind, name, creator_id, dm_user_a, dm_user_b)
  VALUES ('dm', '', v_actor, v_user_a, v_user_b)
  ON CONFLICT (dm_user_a, dm_user_b) DO NOTHING
  RETURNING id, ledger_version INTO v_group_id, v_ledger_version;

  IF v_group_id IS NOT NULL THEN
    v_created := true;
    PERFORM lock_group(v_group_id);

    IF EXISTS (
      SELECT 1 FROM group_member_exclusions
      WHERE group_id = v_group_id AND user_id IN (v_actor, p_user_id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
    END IF;

    INSERT INTO group_members (group_id, user_id, status, accepted_at)
    VALUES (v_group_id, v_actor, 'accepted', now());

    INSERT INTO group_members (group_id, user_id, status, invited_by)
    VALUES (v_group_id, p_user_id, 'invited', v_actor);

    v_event_id := emit_event(
      v_group_id,
      'member_invited',
      v_actor,
      p_subject_user_id => p_user_id,
      p_payload => jsonb_build_object('userIds', jsonb_build_array(p_user_id))
    );

    PERFORM broadcast_user(p_user_id, v_group_id);
  ELSE
    v_created := false;
    SELECT id, ledger_version INTO v_group_id, v_ledger_version
    FROM groups
    WHERE dm_user_a = v_user_a AND dm_user_b = v_user_b;

    PERFORM lock_group(v_group_id);

    IF EXISTS (
      SELECT 1 FROM group_member_exclusions
      WHERE group_id = v_group_id AND user_id IN (v_actor, p_user_id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'groupId', v_group_id,
    'ledgerVersion', v_ledger_version,
    'eventId', v_event_id,
    'created', v_created
  );
END;
$$;

CREATE FUNCTION public.create_invite_link(
  p_group_id uuid,
  p_expires_at timestamptz DEFAULT NULL,
  p_max_uses integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_kind group_kind;
  v_token text;
  v_expires_at timestamptz;
  v_max_uses integer;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  SELECT kind INTO v_kind FROM groups WHERE id = p_group_id;
  IF v_kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;

  IF p_max_uses IS NOT NULL AND p_max_uses <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  UPDATE group_invite_links
  SET is_active = false
  WHERE group_id = p_group_id AND is_active = true;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');

  INSERT INTO group_invite_links (group_id, token, created_by, is_active, expires_at, max_uses)
  VALUES (p_group_id, v_token, v_actor, true, p_expires_at, p_max_uses)
  RETURNING token, expires_at, max_uses INTO v_token, v_expires_at, v_max_uses;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'token', v_token,
    'expiresAt', to_jsonb(v_expires_at),
    'maxUses', v_max_uses
  );
END;
$$;

CREATE FUNCTION public.deactivate_invite_link(p_group_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := current_user_id();

  IF p_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  PERFORM lock_group(p_group_id);
  PERFORM assert_member(p_group_id, v_actor);

  UPDATE group_invite_links
  SET is_active = false
  WHERE group_id = p_group_id AND is_active = true;

  RETURN jsonb_build_object('groupId', p_group_id);
END;
$$;

CREATE FUNCTION public.preview_invite_link(p_token text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_link RECORD;
  v_group RECORD;
  v_creator_name text;
  v_member_count integer;
  v_is_valid boolean;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object(
      'groupName', NULL,
      'memberCount', NULL,
      'creatorName', NULL,
      'valid', false
    );
  END IF;

  SELECT * INTO v_link FROM group_invite_links WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'groupName', NULL,
      'memberCount', NULL,
      'creatorName', NULL,
      'valid', false
    );
  END IF;

  v_is_valid := v_link.is_active
    AND (v_link.expires_at IS NULL OR v_link.expires_at > now())
    AND (v_link.max_uses IS NULL OR v_link.use_count < v_link.max_uses);

  IF NOT v_is_valid THEN
    RETURN jsonb_build_object(
      'groupName', NULL,
      'memberCount', NULL,
      'creatorName', NULL,
      'valid', false
    );
  END IF;

  SELECT * INTO v_group FROM groups WHERE id = v_link.group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'groupName', NULL,
      'memberCount', NULL,
      'creatorName', NULL,
      'valid', false
    );
  END IF;

  SELECT name INTO v_creator_name FROM users WHERE id = v_link.created_by;
  SELECT count(*)::integer INTO v_member_count
  FROM group_members
  WHERE group_id = v_link.group_id AND status = 'accepted';

  RETURN jsonb_build_object(
    'groupName', v_group.name,
    'memberCount', v_member_count,
    'creatorName', v_creator_name,
    'valid', true
  );
END;
$$;

CREATE FUNCTION public.join_via_link(p_token text) RETURNS jsonb
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

  IF EXISTS (
    SELECT 1 FROM group_member_exclusions
    WHERE group_id = v_link.group_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'member_excluded';
  END IF;

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

  -- Shared-history latch: joining a group whose facts already exist makes
  -- them shared from this moment.
  UPDATE public.groups
  SET financial_history_shared_at = now()
  WHERE id = v_link.group_id
    AND financial_history_shared_at IS NULL
    AND (EXISTS (SELECT 1 FROM public.expenses WHERE group_id = v_link.group_id)
         OR EXISTS (SELECT 1 FROM public.settlements WHERE group_id = v_link.group_id));

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


CREATE FUNCTION public.update_profile(
  p_name text DEFAULT NULL,
  p_handle text DEFAULT NULL,
  p_notification_preferences jsonb DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_name text;
  v_handle text;
  v_user users;
BEGIN
  v_actor := current_user_id();

  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) < 1 OR length(v_name) > 80 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_name';
    END IF;
  END IF;

  IF p_handle IS NOT NULL THEN
    v_handle := lower(btrim(p_handle));
    IF v_handle !~ '^[a-z0-9_]{3,30}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_handle';
    END IF;
    IF EXISTS (SELECT 1 FROM users WHERE handle = v_handle AND id <> v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'handle_taken';
    END IF;
  END IF;

  IF p_notification_preferences IS NOT NULL THEN
    IF jsonb_typeof(p_notification_preferences) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_notification_preferences';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_notification_preferences) AS k(key)
      WHERE k.key NOT IN ('expenses', 'settlements', 'nudges', 'groups', 'messages')
        OR jsonb_typeof(p_notification_preferences -> k.key) <> 'boolean'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_notification_preferences';
    END IF;
  END IF;

  UPDATE users
  SET
    name = COALESCE(v_name, name),
    handle = COALESCE(v_handle, handle),
    notification_preferences = notification_preferences || COALESCE(p_notification_preferences, '{}'::jsonb),
    onboarded = true,
    updated_at = now()
  WHERE id = v_actor
  RETURNING * INTO v_user;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'handle', v_user.handle,
    'name', v_user.name,
    'avatarUrl', v_user.avatar_url,
    'email', v_user.email,
    'pixKeyType', v_user.pix_key_type,
    'pixKeyHint', v_user.pix_key_hint,
    'onboarded', v_user.onboarded,
    'notificationPreferences', v_user.notification_preferences
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_group(text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.create_group(text, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.invite_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.invite_member(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.leave_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_group(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_invite_link(uuid, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.create_invite_link(uuid, timestamptz, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.deactivate_invite_link(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.deactivate_invite_link(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.preview_invite_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.preview_invite_link(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.join_via_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_via_link(text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_profile(text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_profile(text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.assert_dm_pair_allowed(uuid, uuid) FROM public, anon, authenticated;
