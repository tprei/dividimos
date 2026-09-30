-- current_user_id's FOR SHARE serialization broke STABLE read RPCs:
-- PostgREST executes them inside read-only transactions, where row locks
-- are forbidden ("cannot execute SELECT FOR SHARE in a read-only
-- transaction"). The lock only matters for callers that can write, so it
-- is now taken only outside read-only transactions; read paths fall back
-- to the plain deleted_at check, which cannot create ghost state.

CREATE OR REPLACE FUNCTION public.current_user_id() RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'unauthenticated';
  END IF;
  IF current_setting('transaction_read_only', true) = 'on' THEN
    SELECT u.id INTO v_user_id
    FROM public.users u
    WHERE u.id = auth.uid() AND u.deleted_at IS NULL;
  ELSE
    SELECT u.id INTO v_user_id
    FROM public.users u
    WHERE u.id = auth.uid() AND u.deleted_at IS NULL
    FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'account_deleted';
  END IF;
  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_id() FROM PUBLIC, anon, authenticated;
