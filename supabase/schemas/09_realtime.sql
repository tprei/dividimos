DROP POLICY IF EXISTS group_broadcast_authz ON realtime.messages;
CREATE POLICY group_broadcast_authz ON realtime.messages FOR SELECT TO authenticated
USING (
  (realtime.topic() LIKE 'group:%' AND public.is_member(substring(realtime.topic() FROM 'group:(.*)')::uuid, auth.uid()))
  OR
  (realtime.topic() LIKE 'chat:%' AND public.is_member(substring(realtime.topic() FROM 'chat:(.*)')::uuid, auth.uid()))
);
