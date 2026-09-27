-- hosts can no longer name a blocked user as a registered assignment room participant
CREATE OR REPLACE FUNCTION public.create_assignment_room(p_room_id uuid, p_group_target jsonb, p_header jsonb, p_items jsonb, p_participants jsonb, p_join_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'guest_credentials', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid;
  v_receipt jsonb;
  v_group_target jsonb;
  v_group_id uuid;
  v_group_kind public.group_kind;
  v_participants jsonb := '[]'::jsonb;
  v_participant jsonb;
  v_participant_id uuid;
  v_user_id uuid;
  v_display_name text;
  v_profile_name text;
  v_host_participant_id uuid;
  v_index integer;
  v_join_digest bytea;
  v_topic text;
  v_existing public.assignment_rooms%ROWTYPE;
  v_stored_items jsonb;
  v_stored_participants jsonb;
BEGIN
  v_actor := public.current_user_id();
  IF p_room_id IS NULL OR p_join_token IS NULL
     OR p_join_token !~ '^armj1_[A-Za-z0-9_-]{43}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  v_join_digest := extensions.digest(convert_to(p_join_token, 'UTF8'), 'sha256');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_room_id::text, 110001));
  v_receipt := public.validate_assignment_room_receipt(p_header, p_items);

  IF p_group_target IS NULL OR jsonb_typeof(p_group_target) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_group_target)) <> 2
     OR jsonb_typeof(p_group_target->'kind') <> 'string'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_group_target->>'kind' = 'existing' THEN
    IF NOT (p_group_target ? 'groupId') OR jsonb_typeof(p_group_target->'groupId') <> 'string'
       OR (p_group_target->>'groupId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_group_id := (p_group_target->>'groupId')::uuid;
    SELECT kind INTO v_group_kind FROM public.groups WHERE id = v_group_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'group_not_found';
    END IF;
    IF v_group_kind = 'dm' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
    END IF;
    PERFORM public.assert_member(v_group_id, v_actor);
    v_group_target := jsonb_build_object('kind', 'existing', 'groupId', v_group_id);
  ELSIF p_group_target->>'kind' = 'new' THEN
    IF NOT (p_group_target ? 'name') OR jsonb_typeof(p_group_target->'name') <> 'string'
       OR length(btrim(p_group_target->>'name')) NOT BETWEEN 1 AND 80
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    v_group_target := jsonb_build_object('kind', 'new', 'name', btrim(p_group_target->>'name'));
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_participants IS NULL OR jsonb_typeof(p_participants) <> 'array'
     OR jsonb_array_length(p_participants) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  FOR v_index IN 0..jsonb_array_length(p_participants) - 1 LOOP
    v_participant := p_participants->v_index;
    IF v_participant IS NULL OR jsonb_typeof(v_participant) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_participant)) <> 3
       OR NOT (v_participant ?& ARRAY['id', 'displayName', 'userId'])
       OR jsonb_typeof(v_participant->'id') <> 'string'
       OR (v_participant->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_participant->'displayName') <> 'string'
       OR length(btrim(v_participant->>'displayName')) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(v_participant->'userId') NOT IN ('string', 'null')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    v_participant_id := (v_participant->>'id')::uuid;
    v_display_name := btrim(v_participant->>'displayName');
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_participants) p
      WHERE p->>'id' = v_participant_id::text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    IF jsonb_typeof(v_participant->'userId') = 'string' THEN
      IF (v_participant->>'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      v_user_id := (v_participant->>'userId')::uuid;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_participants) p
        WHERE p->>'userId' = v_user_id::text
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      SELECT name INTO v_profile_name FROM public.users WHERE id = v_user_id AND onboarded;
      IF NOT FOUND OR v_display_name <> v_profile_name THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
      END IF;
      PERFORM public.assert_user_contact_allowed(v_actor, v_user_id);
    ELSE
      v_user_id := NULL;
    END IF;

    IF v_index = 0 THEN
      IF v_user_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
      END IF;
      v_host_participant_id := v_participant_id;
    ELSIF v_user_id = v_actor THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;

    v_participants := v_participants || jsonb_build_array(jsonb_build_object(
      'id', v_participant_id,
      'displayName', v_display_name,
      'userId', v_user_id
    ));
  END LOOP;

  SELECT * INTO v_existing FROM public.assignment_rooms WHERE id = p_room_id FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'description', description,
      'quantityMilliunits', quantity_milliunits,
      'unitPriceCents', unit_price_cents,
      'totalPriceCents', total_price_cents
    ) ORDER BY ordinal), '[]'::jsonb)
    INTO v_stored_items FROM public.assignment_room_items WHERE room_id = p_room_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'displayName', display_name,
      'userId', user_id
    ) ORDER BY ordinal), '[]'::jsonb)
    INTO v_stored_participants FROM public.assignment_room_participants WHERE room_id = p_room_id;

    IF v_existing.host_user_id IS DISTINCT FROM v_actor
       OR v_existing.group_target IS DISTINCT FROM v_group_target
       OR v_existing.header IS DISTINCT FROM v_receipt->'header'
       OR v_stored_items IS DISTINCT FROM v_receipt->'items'
       OR v_stored_participants IS DISTINCT FROM v_participants
       OR NOT EXISTS (
         SELECT 1 FROM guest_credentials.assignment_room_access a
         WHERE a.room_id = p_room_id AND a.join_digest = v_join_digest
       )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
    END IF;
    RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
  END IF;

  INSERT INTO public.assignment_rooms (id, host_user_id, group_target, header)
  VALUES (p_room_id, v_actor, v_group_target, v_receipt->'header');

  INSERT INTO public.assignment_room_items (
    room_id, id, ordinal, description, quantity_milliunits, unit_price_cents, total_price_cents
  )
  SELECT p_room_id, gen_random_uuid(), ordinality - 1,
         item->>'description',
         (item->>'quantityMilliunits')::integer,
         (item->>'unitPriceCents')::integer,
         (item->>'totalPriceCents')::integer
  FROM jsonb_array_elements(v_receipt->'items') WITH ORDINALITY AS rows(item, ordinality);

  INSERT INTO public.assignment_room_participants (room_id, id, ordinal, display_name, user_id)
  SELECT p_room_id,
         (participant->>'id')::uuid,
         ordinality - 1,
         participant->>'displayName',
         CASE WHEN jsonb_typeof(participant->'userId') = 'string'
              THEN (participant->>'userId')::uuid ELSE NULL END
  FROM jsonb_array_elements(v_participants) WITH ORDINALITY AS rows(participant, ordinality);

  v_topic := 'assignment-room:' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  INSERT INTO guest_credentials.assignment_room_access (room_id, join_digest, join_expires_at, broadcast_topic)
  VALUES (p_room_id, v_join_digest, now() + interval '7 days', v_topic);

  RETURN public.assignment_room_view(p_room_id, v_host_participant_id, true);
EXCEPTION
  WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
END;
$function$;

REVOKE ALL ON FUNCTION public.create_assignment_room(p_room_id uuid, p_group_target jsonb, p_header jsonb, p_items jsonb, p_participants jsonb, p_join_token text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_assignment_room(p_room_id uuid, p_group_target jsonb, p_header jsonb, p_items jsonb, p_participants jsonb, p_join_token text)
  TO service_role, authenticated;
