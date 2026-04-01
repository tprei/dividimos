-- Allow users to see profiles of balance counterparties.
-- Without this, a user removed from group_members would become invisible
-- to co-members who still share an outstanding balance with them.

DROP POLICY IF EXISTS "users_read_visible" ON public.users;

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
    SELECT user_a FROM public.balances
    WHERE group_id IN (SELECT public.my_accepted_group_ids())
    UNION
    SELECT user_b FROM public.balances
    WHERE group_id IN (SELECT public.my_accepted_group_ids())
  )
);
