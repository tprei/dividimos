-- Report creation RPC: service-role only, validates actor, membership, and evidence in SQL.
CREATE FUNCTION public.report_content(
  p_reporter_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_message_id uuid DEFAULT NULL,
  p_details text DEFAULT NULL
) RETURNS TABLE (
  report_id uuid,
  reason public.report_reason,
  details text,
  message_snapshot text,
  notified_at timestamptz,
  reporter_handle text,
  target_handle text,
  group_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_message public.chat_messages%ROWTYPE;
  v_report public.reports%ROWTYPE;
  v_reporter_deleted_at timestamptz;
  v_details text := NULLIF(btrim(p_details), '');
BEGIN
  IF p_reporter_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  SELECT deleted_at INTO v_reporter_deleted_at FROM public.users WHERE id = p_reporter_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  IF v_reporter_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'account_deleted';
  END IF;

  IF p_message_id IS NOT NULL THEN
    SELECT m.* INTO v_message FROM public.chat_messages m WHERE m.id = p_message_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'message_not_found';
    END IF;
    PERFORM public.assert_member(v_message.group_id, p_reporter_id);
  END IF;

  IF p_target_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_target_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;

  IF p_target_user_id = p_reporter_id
     OR (p_message_id IS NOT NULL AND v_message.sender_id <> p_target_user_id)
     OR p_reason IS NULL
     OR p_reason NOT IN (
       'assedio', 'discurso_de_odio', 'ameaca_ou_violencia',
       'conteudo_sexual', 'golpe_ou_spam', 'outro'
     )
     OR length(v_details) > 1000
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;

  INSERT INTO public.reports (
    reporter_id, target_user_id, message_id, group_id,
    reason, details, message_snapshot
  ) VALUES (
    p_reporter_id, p_target_user_id, p_message_id, v_message.group_id,
    p_reason::public.report_reason, v_details, v_message.content
  ) ON CONFLICT DO NOTHING;

  SELECT r.* INTO v_report FROM public.reports r
  WHERE r.reporter_id = p_reporter_id
    AND r.status = 'open'
    AND (
      (p_message_id IS NOT NULL AND r.message_id = p_message_id)
      OR
      (p_message_id IS NULL AND r.message_id IS NULL AND r.target_user_id = p_target_user_id)
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'report_not_found';
  END IF;

  RETURN QUERY
  SELECT v_report.id, v_report.reason, v_report.details, v_report.message_snapshot,
         v_report.notified_at, reporter.handle, target.handle, g.name
  FROM public.users reporter
  JOIN public.users target ON target.id = v_report.target_user_id
  LEFT JOIN public.groups g ON g.id = v_report.group_id
  WHERE reporter.id = v_report.reporter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_content(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_content(uuid, uuid, text, uuid, text)
  TO service_role;
