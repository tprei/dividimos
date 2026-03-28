-- Fix: expense RLS policies should only grant access to ACCEPTED group members,
-- not invited-but-not-accepted members.
--
-- The existing my_group_ids() function returns ALL groups (including invited),
-- which is needed for group_members_select (so users can see & accept invitations).
-- For expense visibility, we need a stricter variant.

-- Helper: group_ids where the current user is an ACCEPTED member or the creator
CREATE OR REPLACE FUNCTION public.my_accepted_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT group_id FROM public.group_members
  WHERE user_id = auth.uid() AND status = 'accepted'
  UNION
  SELECT id FROM public.groups
  WHERE creator_id = auth.uid()
$$;

-- ============================================================
-- UPDATE EXPENSE POLICIES to use my_accepted_group_ids()
-- ============================================================

-- expenses: SELECT
DROP POLICY IF EXISTS expenses_select ON expenses;
CREATE POLICY expenses_select ON expenses
  FOR SELECT USING (group_id IN (SELECT my_accepted_group_ids()));

-- expenses: INSERT — creator must be accepted member of the group
DROP POLICY IF EXISTS expenses_insert ON expenses;
CREATE POLICY expenses_insert ON expenses
  FOR INSERT WITH CHECK (
    creator_id = auth.uid()
    AND group_id IN (SELECT my_accepted_group_ids())
  );

-- expenses: UPDATE — only creator, must still be in group
DROP POLICY IF EXISTS expenses_update ON expenses;
CREATE POLICY expenses_update ON expenses
  FOR UPDATE
  USING (creator_id = auth.uid() AND group_id IN (SELECT my_accepted_group_ids()))
  WITH CHECK (creator_id = auth.uid());

-- expenses: DELETE — only creator, must still be in group
DROP POLICY IF EXISTS expenses_delete ON expenses;
CREATE POLICY expenses_delete ON expenses
  FOR DELETE USING (creator_id = auth.uid() AND group_id IN (SELECT my_accepted_group_ids()));

-- expense_items: SELECT
DROP POLICY IF EXISTS expense_items_select ON expense_items;
CREATE POLICY expense_items_select ON expense_items
  FOR SELECT USING (
    expense_id IN (
      SELECT id FROM expenses WHERE group_id IN (SELECT my_accepted_group_ids())
    )
  );

-- expense_items: INSERT (unchanged logic but recreated for consistency)
DROP POLICY IF EXISTS expense_items_insert ON expense_items;
CREATE POLICY expense_items_insert ON expense_items
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_items: UPDATE
DROP POLICY IF EXISTS expense_items_update ON expense_items;
CREATE POLICY expense_items_update ON expense_items
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_items: DELETE
DROP POLICY IF EXISTS expense_items_delete ON expense_items;
CREATE POLICY expense_items_delete ON expense_items
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_shares: SELECT
DROP POLICY IF EXISTS expense_shares_select ON expense_shares;
CREATE POLICY expense_shares_select ON expense_shares
  FOR SELECT USING (
    expense_id IN (
      SELECT id FROM expenses WHERE group_id IN (SELECT my_accepted_group_ids())
    )
  );

-- expense_shares: INSERT
DROP POLICY IF EXISTS expense_shares_insert ON expense_shares;
CREATE POLICY expense_shares_insert ON expense_shares
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_shares: UPDATE
DROP POLICY IF EXISTS expense_shares_update ON expense_shares;
CREATE POLICY expense_shares_update ON expense_shares
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_shares: DELETE
DROP POLICY IF EXISTS expense_shares_delete ON expense_shares;
CREATE POLICY expense_shares_delete ON expense_shares
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_payers: SELECT
DROP POLICY IF EXISTS expense_payers_select ON expense_payers;
CREATE POLICY expense_payers_select ON expense_payers
  FOR SELECT USING (
    expense_id IN (
      SELECT id FROM expenses WHERE group_id IN (SELECT my_accepted_group_ids())
    )
  );

-- expense_payers: INSERT
DROP POLICY IF EXISTS expense_payers_insert ON expense_payers;
CREATE POLICY expense_payers_insert ON expense_payers
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_payers: UPDATE
DROP POLICY IF EXISTS expense_payers_update ON expense_payers;
CREATE POLICY expense_payers_update ON expense_payers
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- expense_payers: DELETE
DROP POLICY IF EXISTS expense_payers_delete ON expense_payers;
CREATE POLICY expense_payers_delete ON expense_payers
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- balances: SELECT — accepted members only
DROP POLICY IF EXISTS balances_select ON balances;
CREATE POLICY balances_select ON balances
  FOR SELECT USING (group_id IN (SELECT my_accepted_group_ids()));

-- settlements: SELECT — accepted members only
DROP POLICY IF EXISTS settlements_select ON settlements;
CREATE POLICY settlements_select ON settlements
  FOR SELECT USING (group_id IN (SELECT my_accepted_group_ids()));

-- settlements: INSERT — from_user must be accepted member
DROP POLICY IF EXISTS settlements_insert ON settlements;
CREATE POLICY settlements_insert ON settlements
  FOR INSERT WITH CHECK (
    from_user_id = auth.uid()
    AND group_id IN (SELECT my_accepted_group_ids())
  );
