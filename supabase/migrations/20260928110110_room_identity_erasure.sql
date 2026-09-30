CREATE OR REPLACE FUNCTION public.enforce_assignment_room_immutability() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_identity_erasure boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'assignment_room_participants' THEN
    v_identity_erasure := v_new->>'display_name' = 'Conta excluída'
      AND v_new->'user_id' IS NOT DISTINCT FROM v_old->'user_id'
      AND v_new->'removed_at' IS DISTINCT FROM 'null'::jsonb
      AND EXISTS (
        SELECT 1 FROM public.users
        WHERE id = (v_old->>'user_id')::uuid AND deleted_at IS NOT NULL
      );
  END IF;
  IF TG_TABLE_NAME = 'assignment_rooms' AND (
    v_new->'id' IS DISTINCT FROM v_old->'id' OR
    v_new->'host_user_id' IS DISTINCT FROM v_old->'host_user_id' OR
    v_new->'group_target' IS DISTINCT FROM v_old->'group_target' OR
    v_new->'header' IS DISTINCT FROM v_old->'header' OR
    v_new->'created_at' IS DISTINCT FROM v_old->'created_at'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  ELSIF TG_TABLE_NAME = 'assignment_room_items' AND (
    v_new->'room_id' IS DISTINCT FROM v_old->'room_id' OR
    v_new->'id' IS DISTINCT FROM v_old->'id' OR
    v_new->'ordinal' IS DISTINCT FROM v_old->'ordinal' OR
    v_new->'description' IS DISTINCT FROM v_old->'description' OR
    v_new->'quantity_milliunits' IS DISTINCT FROM v_old->'quantity_milliunits' OR
    v_new->'unit_price_cents' IS DISTINCT FROM v_old->'unit_price_cents' OR
    v_new->'total_price_cents' IS DISTINCT FROM v_old->'total_price_cents' OR
    v_new->'icon' IS DISTINCT FROM v_old->'icon'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  ELSIF TG_TABLE_NAME = 'assignment_room_participants' AND (
    v_new->'room_id' IS DISTINCT FROM v_old->'room_id' OR
    v_new->'id' IS DISTINCT FROM v_old->'id' OR
    v_new->'ordinal' IS DISTINCT FROM v_old->'ordinal' OR
    (v_new->'display_name' IS DISTINCT FROM v_old->'display_name' AND NOT v_identity_erasure) OR
    (pg_trigger_depth() = 1 AND v_new->'user_id' IS DISTINCT FROM v_old->'user_id') OR
    ((v_old->>'ordinal')::integer = 0 AND v_new->'removed_at' IS DISTINCT FROM 'null'::jsonb AND NOT v_identity_erasure)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_operation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_assignment_room_immutability() FROM PUBLIC, anon, authenticated;
