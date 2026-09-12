CREATE TABLE public.vendor_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999),
  description text CHECK (description IS NULL OR length(description) <= 160),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

ALTER TABLE public.vendor_charges ENABLE ROW LEVEL SECURITY;

CREATE INDEX vendor_charges_user_idx ON public.vendor_charges (user_id, created_at DESC);

CREATE FUNCTION public.record_vendor_charge(p_amount_cents integer, p_description text DEFAULT NULL)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_row vendor_charges;
BEGIN
  v_actor := current_user_id();

  IF p_amount_cents IS NULL OR p_amount_cents < 1 OR p_amount_cents > 99999999 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  IF p_description IS NOT NULL AND length(p_description) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  INSERT INTO vendor_charges (user_id, amount_cents, description, status, created_at)
  VALUES (v_actor, p_amount_cents, p_description, 'pending', now())
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
$$;

CREATE FUNCTION public.confirm_vendor_charge(p_charge_id uuid)
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
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
$$;
CREATE FUNCTION public.cancel_vendor_charge(p_charge_id uuid)
RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
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
$$;

CREATE FUNCTION public.get_vendor_charges(p_limit integer DEFAULT 50)
RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
$$;

REVOKE ALL ON TABLE public.vendor_charges FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_vendor_charge(integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_vendor_charge(integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_vendor_charge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_vendor_charge(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_vendor_charge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_vendor_charge(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_vendor_charges(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_vendor_charges(integer) TO authenticated;
