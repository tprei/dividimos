-- Owner-only profile read boundary.
--
-- The users_read_visible policy intentionally lets a caller read related
-- users (accepted-group members, group creators, balance counterparties),
-- so a direct users.select().eq("id", someId) is not a self-profile
-- capability: a retained request for one account can still return that
-- account's row after the caller's JWT has changed to a related account.
--
-- This function derives its row exclusively from auth.uid() and takes no
-- arguments, so a caller cannot name a target. It never returns the Pix
-- ciphertext column.

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (
  id uuid,
  email text,
  handle text,
  name text,
  avatar_url text,
  onboarded boolean,
  created_at timestamptz,
  notification_preferences jsonb,
  pix_key_type public.pix_key_type,
  pix_key_hint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    u.id,
    u.email,
    u.handle,
    u.name,
    u.avatar_url,
    u.onboarded,
    u.created_at,
    u.notification_preferences,
    u.pix_key_type,
    u.pix_key_hint
  FROM public.users AS u
  WHERE u.id = (SELECT auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- The effective catalog state is asserted in the same transaction that
-- creates the function. PostgREST exposes only public and graphql_public,
-- so an application test cannot read pg_proc; a weaker execution contract
-- must fail here rather than survive into deployment.
DO $assert_get_my_profile$
DECLARE
  fn_oid oid := pg_catalog.to_regprocedure('public.get_my_profile()');
  fn pg_catalog.pg_proc%ROWTYPE;
BEGIN
  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'public.get_my_profile() is missing';
  END IF;

  SELECT p.* INTO STRICT fn
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = fn_oid;

  IF fn.pronargs <> 0
     OR fn.prokind <> 'f'
     OR fn.prosecdef IS DISTINCT FROM true
     OR fn.provolatile <> 's'
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'public.get_my_profile() execution contract is invalid';
  END IF;

  IF fn.prorettype <> pg_catalog.to_regtype('record')
     OR fn.proallargtypes IS DISTINCT FROM ARRAY[
       pg_catalog.to_regtype('uuid'),
       pg_catalog.to_regtype('text'),
       pg_catalog.to_regtype('text'),
       pg_catalog.to_regtype('text'),
       pg_catalog.to_regtype('text'),
       pg_catalog.to_regtype('boolean'),
       pg_catalog.to_regtype('timestamptz'),
       pg_catalog.to_regtype('jsonb'),
       pg_catalog.to_regtype('public.pix_key_type'),
       pg_catalog.to_regtype('text')
     ]::oid[]
     OR fn.proargmodes IS DISTINCT FROM ARRAY[
       't','t','t','t','t','t','t','t','t','t'
     ]::"char"[]
     OR fn.proargnames IS DISTINCT FROM ARRAY[
       'id','email','handle','name','avatar_url','onboarded','created_at',
       'notification_preferences','pix_key_type','pix_key_hint'
     ]::text[] THEN
    RAISE EXCEPTION 'public.get_my_profile() return contract is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      COALESCE(fn.proacl, pg_catalog.acldefault('f', fn.proowner))
    ) AS acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
  OR pg_catalog.has_function_privilege('anon', fn_oid, 'EXECUTE')
  OR NOT pg_catalog.has_function_privilege('authenticated', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.get_my_profile() ACL is invalid';
  END IF;
END;
$assert_get_my_profile$;
