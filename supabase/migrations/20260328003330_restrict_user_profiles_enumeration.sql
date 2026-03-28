-- Prevent authenticated users from enumerating all user profiles.
-- Switch the view to security_invoker so RLS on users applies, then add
-- a policy that only exposes co-members (shared group or bill).
-- Handle lookup (needed for invites before any shared context exists)
-- goes through a SECURITY DEFINER function that returns one row at a time.

CREATE OR REPLACE VIEW public.user_profiles
  WITH (security_invoker = true) AS
  SELECT id, handle, name, avatar_url
  FROM public.users;

DROP POLICY IF EXISTS "users_read_own" ON public.users;

CREATE POLICY "users_read_visible" ON public.users FOR SELECT
USING (
  id = auth.uid()
  OR id IN (
    SELECT user_id FROM public.group_members
    WHERE group_id IN (SELECT public.my_group_ids())
  )
  OR id IN (
    SELECT creator_id FROM public.groups
    WHERE id IN (SELECT public.my_group_ids())
  )
  OR id IN (
    SELECT user_id FROM public.bill_participants
    WHERE bill_id IN (SELECT public.my_bill_ids())
  )
  OR id IN (
    SELECT creator_id FROM public.bills
    WHERE id IN (SELECT public.my_bill_ids())
  )
);

CREATE OR REPLACE FUNCTION public.lookup_user_by_handle(p_handle TEXT)
RETURNS TABLE(id UUID, handle TEXT, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.handle, u.name, u.avatar_url
  FROM public.users u
  WHERE u.handle = lower(trim(p_handle))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_user_by_handle(TEXT) TO authenticated;
