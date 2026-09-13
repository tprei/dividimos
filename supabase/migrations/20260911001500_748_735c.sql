-- 735c: page charges and report authoritative summaries.

drop function if exists "public"."get_vendor_charges"(p_limit integer);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_vendor_charges(p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;



REVOKE ALL ON FUNCTION public.get_vendor_charges(timestamptz, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_vendor_charges(timestamptz, uuid, integer) TO authenticated;
