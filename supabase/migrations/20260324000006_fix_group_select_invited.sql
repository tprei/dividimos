-- Fix: invited users can't see group name because groups SELECT policy filters on status='accepted'
-- Replace with my_group_ids() which includes all statuses and avoids self-referencing

DROP POLICY IF EXISTS "group_select" ON groups;
CREATE POLICY "group_select" ON groups FOR SELECT
  USING (
    creator_id = auth.uid()
    OR id IN (SELECT public.my_group_ids())
  );
