-- Daily paid-AI budget for the Gemini-backed routes (receipt OCR, voice
-- expense parsing, voice transcription, chat parsing). The per-minute limiter
-- alone let a single account spend ~172k paid provider calls per day; this
-- adds a 200/day ceiling enforced server-side.
--
-- service_role-only: the Next.js API routes call it through the admin client
-- with the authenticated user id. The deleted-account check happens BEFORE the
-- increment because delete_account wipes rate_limit_counters for the user: a
-- still-valid access token signed before deletion (ES256, verified locally
-- via JWKS) must stop reaching paid routes immediately, not until token
-- expiry, and must not resurrect a counter row by spending tokens.
CREATE FUNCTION public.consume_ai_request(p_user_id uuid) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'account_deleted' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.increment_rate_limit('ai.daily', p_user_id::text, 200, 86400);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_request(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_request(uuid)
  TO service_role;
