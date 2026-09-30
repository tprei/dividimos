-- Delivery receipt and operator resolution RPCs for the reports queue.
CREATE FUNCTION public.mark_report_notified(p_report_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_report_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  UPDATE public.reports
  SET notified_at = COALESCE(notified_at, now())
  WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'report_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_report_notified(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_report_notified(uuid) TO service_role;

CREATE FUNCTION public.resolve_report(
  p_report_id uuid,
  p_status text,
  p_note text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF p_report_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('resolved', 'dismissed')
     OR v_note IS NULL OR length(v_note) > 2000
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  UPDATE public.reports
  SET status = p_status::public.report_status,
      resolution_note = v_note,
      resolved_at = now()
  WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'report_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_report(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_report(uuid, text, text) TO service_role;
