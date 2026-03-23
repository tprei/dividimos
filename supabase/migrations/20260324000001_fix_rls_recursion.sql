-- Fix: RLS infinite recursion on group_members and bill_participants
-- Root cause: SELECT policies contain subqueries that SELECT from the same table
-- Solution: SECURITY DEFINER helper functions bypass RLS for membership lookups

CREATE OR REPLACE FUNCTION public.my_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  UNION
  SELECT id FROM public.groups WHERE creator_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.my_bill_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT bill_id FROM public.bill_participants WHERE user_id = auth.uid()
  UNION
  SELECT id FROM public.bills WHERE creator_id = auth.uid()
$$;

-- group_members: was self-referencing
DROP POLICY IF EXISTS "group_members_select" ON group_members;
CREATE POLICY "group_members_select" ON group_members FOR SELECT
  USING (group_id IN (SELECT public.my_group_ids()));

-- bill_participants: was self-referencing
DROP POLICY IF EXISTS "Participants can read bill participants" ON bill_participants;
CREATE POLICY "bill_participants_select" ON bill_participants FOR SELECT
  USING (bill_id IN (SELECT public.my_bill_ids()));

-- bills: referenced bill_participants which recurses
DROP POLICY IF EXISTS "Users can read bills they participate in" ON bills;
CREATE POLICY "bills_select" ON bills FOR SELECT
  USING (creator_id = auth.uid() OR id IN (SELECT public.my_bill_ids()));

-- bill_items: referenced bill_participants
DROP POLICY IF EXISTS "Participants can read items" ON bill_items;
CREATE POLICY "bill_items_select" ON bill_items FOR SELECT
  USING (bill_id IN (SELECT public.my_bill_ids()));

-- item_splits: referenced bill_participants via bill_items join
DROP POLICY IF EXISTS "Participants can read splits" ON item_splits;
CREATE POLICY "item_splits_select" ON item_splits FOR SELECT
  USING (
    item_id IN (
      SELECT bi.id FROM public.bill_items bi
      WHERE bi.bill_id IN (SELECT public.my_bill_ids())
    )
  );
