-- blocked pairs cannot gain a new user participant slot in expenses; edits that keep the existing identities stay allowed
CREATE OR REPLACE FUNCTION public.resolve_expense_participants(p_expense_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_group_id uuid;
  v_current_version integer;
  v_prev_payload jsonb;
  v_existing_user_ids uuid[] := '{}';
  v_participants jsonb;
  v_n integer;
  v_i integer;
  v_participant jsonb;
  v_user_id uuid;
  v_guest_id uuid;
  v_new_guest_id uuid;
  v_claimed_by uuid;
  v_claimed_version_no integer;
  v_display_name text;
  v_out_participants jsonb := '[]'::jsonb;
  v_out jsonb;
  v_seen_users uuid[] := '{}';
  v_kept_guest_ids uuid[] := '{}';
BEGIN
  v_actor := public.current_user_id();

  SELECT e.group_id, e.current_version_no INTO v_group_id, v_current_version
  FROM expenses e WHERE e.id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  v_prev_payload := effective_expense_payload(p_expense_id, v_current_version);
  SELECT COALESCE(array_agg((pa.el->>'userId')::uuid), '{}') INTO v_existing_user_ids
  FROM jsonb_array_elements(COALESCE(v_prev_payload->'participants', '[]'::jsonb)) AS pa(el)
  WHERE pa.el->>'kind' = 'user' AND pa.el ? 'userId';

  v_participants := p_payload->'participants';
  IF v_participants IS NULL OR jsonb_typeof(v_participants) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;
  v_n := jsonb_array_length(v_participants);
  IF v_n = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
  END IF;

  v_i := 0;
  WHILE v_i < v_n LOOP
    v_participant := v_participants->v_i;
    v_user_id := NULL;
    v_guest_id := NULL;
    v_new_guest_id := NULL;
    v_claimed_by := NULL;
    v_claimed_version_no := NULL;
    v_display_name := NULL;

    IF v_participant->>'kind' = 'user' THEN
      v_user_id := (v_participant->>'userId')::uuid;
      IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
      END IF;
      PERFORM assert_dm_pair_allowed(v_group_id, v_user_id);
      IF NOT is_member_or_invited(v_group_id, v_user_id)
         AND NOT COALESCE(v_user_id = ANY (v_existing_user_ids), false) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
      END IF;
    ELSIF v_participant->>'kind' = 'guest' THEN
      v_display_name := v_participant->>'displayName';
      IF jsonb_typeof(v_participant->'guestId') = 'string' THEN
        v_guest_id := (v_participant->>'guestId')::uuid;
        SELECT id, claimed_by, claimed_version_no INTO v_new_guest_id, v_claimed_by, v_claimed_version_no
        FROM guests WHERE id = v_guest_id AND expense_id = p_expense_id;
        IF v_new_guest_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
        END IF;
      ELSE
        INSERT INTO guests (expense_id, display_name) VALUES (p_expense_id, v_display_name)
        RETURNING id INTO v_new_guest_id;
      END IF;

      IF v_claimed_by IS NOT NULL AND v_claimed_version_no = v_current_version THEN
        v_guest_id := NULL;
        v_user_id := v_claimed_by;
        PERFORM assert_dm_pair_allowed(v_group_id, v_user_id);
        IF NOT is_member_or_invited(v_group_id, v_user_id)
           AND NOT (v_user_id = ANY (v_existing_user_ids)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_a_member';
        END IF;
      ELSE
        v_guest_id := v_new_guest_id;
        v_kept_guest_ids := array_append(v_kept_guest_ids, v_guest_id);
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_payload';
    END IF;

    IF v_user_id IS NOT NULL THEN
      IF v_user_id = ANY (v_seen_users) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'duplicate_participant';
      END IF;
      IF NOT (v_user_id = ANY (v_existing_user_ids)) THEN
        PERFORM public.assert_user_contact_allowed(v_actor, v_user_id);
      END IF;
      v_seen_users := array_append(v_seen_users, v_user_id);
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'user', 'userId', v_user_id);
    ELSE
      v_out_participants := v_out_participants || jsonb_build_object('kind', 'guest', 'guestId', v_guest_id, 'displayName', v_display_name);
    END IF;

    v_i := v_i + 1;
  END LOOP;

  DELETE FROM guests g
  WHERE g.expense_id = p_expense_id
    AND g.claimed_by IS NULL
    AND NOT (g.id = ANY (v_kept_guest_ids));

  v_out := jsonb_set(p_payload, '{participants}', v_out_participants);
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_expense_participants(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_expense_participants(uuid, jsonb)
  TO service_role;
