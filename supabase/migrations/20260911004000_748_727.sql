-- 727: keep pre-onboarding profiles out of handle lookup.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lookup_user_by_handle(p_handle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  -- Handles are derived from the email local-part at signup, so a
  -- pre-onboarding handle is guessable. Until the user completes public
  -- profile setup, their OAuth name and avatar are not discoverable.
  SELECT COALESCE(ledger_user_profile_json(u.id), 'null'::jsonb) INTO v_out
  FROM users u
  WHERE u.handle = lower(trim(p_handle))
    AND u.onboarded;
  RETURN COALESCE(v_out, 'null'::jsonb);
END;
$function$
;
