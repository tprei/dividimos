-- 721: cancel abandoned Quick Charge generations.

alter table "public"."vendor_charges" drop constraint "vendor_charges_status_check";

alter table "public"."vendor_charges" add constraint "vendor_charges_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'received'::text, 'cancelled'::text]))) not valid;

alter table "public"."vendor_charges" validate constraint "vendor_charges_status_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cancel_vendor_charge(p_charge_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_status text;
  v_owner uuid;
BEGIN
  v_actor := current_user_id();

  IF p_charge_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'charge_not_found';
  END IF;

  SELECT status, user_id
  INTO v_status, v_owner
  FROM vendor_charges
  WHERE id = p_charge_id
  FOR UPDATE;

  IF NOT FOUND OR v_owner <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'charge_not_found';
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN;
  END IF;

  IF v_status = 'received' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'charge_already_received';
  END IF;

  UPDATE vendor_charges
  SET status = 'cancelled'
  WHERE id = p_charge_id AND user_id = v_actor AND status = 'pending';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_vendor_charge(p_charge_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_row vendor_charges;
BEGIN
  v_actor := current_user_id();

  IF p_charge_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  SELECT * INTO v_row
  FROM vendor_charges
  WHERE id = p_charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'charge_not_found';
  END IF;

  IF v_row.user_id <> v_actor THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'not_owner';
  END IF;

  IF v_row.status = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'charge_cancelled';
  END IF;

  IF v_row.status = 'received' THEN
    RETURN jsonb_build_object(
      'id', v_row.id,
      'userId', v_row.user_id,
      'amountCents', v_row.amount_cents,
      'description', v_row.description,
      'status', v_row.status,
      'createdAt', to_jsonb(v_row.created_at),
      'confirmedAt', to_jsonb(v_row.confirmed_at)
    );
  END IF;

  UPDATE vendor_charges
  SET status = 'received', confirmed_at = now()
  WHERE id = p_charge_id AND status = 'pending'
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'userId', v_row.user_id,
    'amountCents', v_row.amount_cents,
    'description', v_row.description,
    'status', v_row.status,
    'createdAt', to_jsonb(v_row.created_at),
    'confirmedAt', to_jsonb(v_row.confirmed_at)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_vendor_charges(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_result jsonb;
BEGIN
  v_actor := current_user_id();

  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 50;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', vc.id,
      'userId', vc.user_id,
      'amountCents', vc.amount_cents,
      'description', vc.description,
      'status', vc.status,
      'createdAt', to_jsonb(vc.created_at),
      'confirmedAt', to_jsonb(vc.confirmed_at)
    )
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT *
    FROM vendor_charges
    WHERE user_id = v_actor AND status <> 'cancelled'
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit
  ) vc;

  RETURN v_result;
END;
$function$
;



REVOKE ALL ON FUNCTION public.cancel_vendor_charge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_vendor_charge(uuid) TO authenticated;
