-- The previous migration's user-topic branch queried public.users directly
-- inside the realtime policy. Policies run as the subscribing role, and
-- authenticated has no privilege on public.users (RPC-only access), so
-- every private user-topic join was denied, including live accounts. The
-- live-account check moves into a SECURITY DEFINER helper, mirroring
-- current_user_is_member for the group and chat branches.

CREATE OR REPLACE FUNCTION public.current_user_is_active() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.deleted_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_is_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated;

DROP POLICY IF EXISTS group_broadcast_authz ON realtime.messages;
CREATE POLICY group_broadcast_authz ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'user:%' THEN
      substring(
        realtime.topic()
        FROM '^user:([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$'
      )::uuid = auth.uid()
      AND public.current_user_is_active()
    ELSE
      public.current_user_is_member(
        substring(
          realtime.topic()
          FROM '^(?:group|chat):([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$'
        )::uuid
      )
  END
);
