-- Sign in with Apple stores one row per account: the Apple subject linked in
-- Auth and the refresh token Apple returned for the authorization, encrypted
-- with the same AES-256-GCM key as Pix keys (iv:tag:ciphertext). The token is
-- the only way to revoke the Apple authorization when the account is deleted
-- (App Store guideline 5.1.1(v)), so it must outlive the delete_account
-- tombstone: the deletion route reads the row AFTER delete_account and removes
-- it only when Apple confirms the revocation (HTTP 200) or reports it already
-- gone (invalid_grant). Purging the row inside delete_account would destroy
-- the token a retry needs. The FK cascade remains the backstop for a hard
-- auth-user delete; a tombstoned account cannot register a new row.
SET lock_timeout = '5s';

CREATE TABLE public.apple_sign_in_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  apple_subject text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apple_sign_in_credentials_subject_bounds
    CHECK (btrim(apple_subject) <> '' AND octet_length(apple_subject) BETWEEN 1 AND 255),
  CONSTRAINT apple_sign_in_credentials_token_format
    CHECK (
      refresh_token_encrypted ~ '^[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$'
      AND octet_length(refresh_token_encrypted) <= 2048
    )
);

ALTER TABLE public.apple_sign_in_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.apple_sign_in_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.apple_sign_in_credentials TO service_role;

-- Upsert for the caller id the route derives from verified session claims and
-- the Apple subject the route verified against Apple's signed id_token. The
-- deleted-account guard mirrors claim_push_subscription.
CREATE FUNCTION public.store_apple_credential(
  p_user_id uuid,
  p_apple_subject text,
  p_refresh_token_encrypted text
) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_at timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_apple_subject IS NULL OR p_refresh_token_encrypted IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_argument';
  END IF;
  SELECT deleted_at INTO v_deleted_at FROM public.users WHERE id = p_user_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'user_not_found';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'account_deleted';
  END IF;
  INSERT INTO public.apple_sign_in_credentials (user_id, apple_subject, refresh_token_encrypted)
  VALUES (p_user_id, p_apple_subject, p_refresh_token_encrypted)
  ON CONFLICT (user_id) DO UPDATE
  SET apple_subject = EXCLUDED.apple_subject,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.store_apple_credential(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_apple_credential(uuid, text, text) TO service_role;

-- Read-for-revocation returns the stored credential to the deletion route, or
-- NULL when the account never linked Apple or the row is already gone. It
-- deliberately has no account_deleted guard: revocation happens exactly when
-- the profile is already tombstoned.
CREATE FUNCTION public.read_apple_credential_for_revocation(p_user_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN c.user_id IS NULL THEN NULL ELSE jsonb_build_object(
    'appleSubject', c.apple_subject,
    'refreshTokenEncrypted', c.refresh_token_encrypted
  ) END
  FROM public.apple_sign_in_credentials c
  WHERE c.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.read_apple_credential_for_revocation(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_apple_credential_for_revocation(uuid) TO service_role;

-- Called by the deletion route only after Apple gave a definitive outcome for
-- the stored refresh token (HTTP 200 or invalid_grant).
CREATE FUNCTION public.delete_apple_credential(p_user_id uuid) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  DELETE FROM public.apple_sign_in_credentials WHERE user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.delete_apple_credential(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_apple_credential(uuid) TO service_role;
