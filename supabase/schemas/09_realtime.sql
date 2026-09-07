-- Topic ids are matched as uuids: a malformed topic yields a clean denial
-- instead of an "invalid input syntax for type uuid" during policy evaluation.
CREATE FUNCTION public.current_user_is_member(p_group_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = auth.uid() AND status = 'accepted'
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_is_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_is_member(uuid) TO authenticated;

DROP POLICY IF EXISTS group_broadcast_authz ON realtime.messages;
CREATE POLICY group_broadcast_authz ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'user:%' THEN
      substring(realtime.topic() FROM '^user:([0-9a-fA-F-]{36})$')::uuid = auth.uid()
    ELSE
      public.current_user_is_member(
        substring(realtime.topic() FROM '^(?:group|chat):([0-9a-fA-F-]{36})$')::uuid
      )
  END
);
