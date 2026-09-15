-- Strict topic parsing: the previous permissive character-class regexes
-- ([0-9a-fA-F-]{36}) matched 36 hyphens and then died on the uuid cast,
-- raising an error instead of denying. The exact UUID grammar below never
-- matches a malformed topic, so the cast only ever sees valid text and every
-- malformed topic falls through to a plain policy denial. Authorization
-- rules for valid topics are unchanged.
DROP POLICY IF EXISTS group_broadcast_authz ON realtime.messages;
CREATE POLICY group_broadcast_authz ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'user:%' THEN
      substring(
        realtime.topic()
        FROM '^user:([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$'
      )::uuid = auth.uid()
    ELSE
      public.current_user_is_member(
        substring(
          realtime.topic()
          FROM '^(?:group|chat):([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$'
        )::uuid
      )
  END
);
