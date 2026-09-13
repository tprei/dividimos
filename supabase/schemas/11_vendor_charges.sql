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

CREATE FUNCTION public.get_vendor_charges(
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_charges jsonb;
  v_cursor jsonb;
  v_complete boolean;
  v_today_start timestamptz;
  v_today_end timestamptz;
BEGIN
  v_actor := current_user_id();

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  -- Convert the local calendar day separately in each direction: a fixed UTC
  -- offset would drift across a Sao Paulo DST change.
  v_today_start := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AT TIME ZONE 'America/Sao_Paulo';
  v_today_end := (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day') AT TIME ZONE 'America/Sao_Paulo';

  WITH page AS (
    SELECT id, created_at, user_id, amount_cents, description, status, confirmed_at,
      row_number() OVER (ORDER BY created_at DESC, id DESC) AS row_no
    FROM vendor_charges
    WHERE user_id = v_actor
      AND status <> 'cancelled'
      AND (
        p_before_id IS NULL
        OR (created_at, id) < (p_before_created_at, p_before_id)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit + 1
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'userId', p.user_id,
        'amountCents', p.amount_cents,
        'description', p.description,
        'status', p.status,
        'createdAt', to_jsonb(p.created_at),
        'confirmedAt', to_jsonb(p.confirmed_at)
      ) ORDER BY p.created_at DESC, p.id DESC
    ) FILTER (WHERE p.row_no <= p_limit), '[]'::jsonb),
    count(*) <= p_limit,
    COALESCE((
      SELECT jsonb_build_object('createdAt', to_jsonb(last_row.created_at), 'id', last_row.id)
      FROM page last_row
      WHERE last_row.row_no = p_limit AND (SELECT count(*) FROM page) > p_limit
    ), 'null'::jsonb)
  INTO v_charges, v_complete, v_cursor
  FROM page p;

  RETURN jsonb_build_object(
    'charges', v_charges,
    'nextCursor', v_cursor,
    'complete', v_complete,
    -- Counts and sums cover every uncancelled charge, not the page.
    'total', (
      SELECT count(*)::integer FROM vendor_charges
      WHERE user_id = v_actor AND status <> 'cancelled'
    ),
    'receivedCount', (
      SELECT count(*)::integer FROM vendor_charges
      WHERE user_id = v_actor AND status = 'received'
    ),
    -- bigint: a day's takings can exceed int4 and must never be truncated.
    'receivedTodayCents', (
      SELECT COALESCE(sum(amount_cents), 0)::bigint FROM vendor_charges
      WHERE user_id = v_actor
        AND status = 'received'
        AND confirmed_at IS NOT NULL
        AND confirmed_at >= v_today_start
        AND confirmed_at < v_today_end
    )
  );
END;
$$;

REVOKE ALL ON TABLE public.vendor_charges FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_vendor_charge(integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_vendor_charge(integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_vendor_charge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_vendor_charge(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_vendor_charge(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_vendor_charge(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_vendor_charges(timestamptz, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_vendor_charges(timestamptz, uuid, integer) TO authenticated;
