-- Fix: group_members INSERT policy has self-referencing subquery causing recursion
-- Replace direct subquery with my_group_ids() helper

DROP POLICY IF EXISTS "group_members_insert" ON group_members;
CREATE POLICY "group_members_insert" ON group_members FOR INSERT
  WITH CHECK (
    invited_by = auth.uid()
    AND group_id IN (SELECT public.my_group_ids())
  );
