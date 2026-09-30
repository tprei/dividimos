-- create_group accepted member id lists of unlimited size; lists over 50 ids are now refused with invalid_argument before anything is created
CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_member_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF cardinality(p_member_ids) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
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
$function$;

REVOKE ALL ON FUNCTION public.create_group(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_group(text, uuid[])
  TO service_role, authenticated;
