-- Allow creators to delete their own draft bills.
-- Cascade FK constraints on child tables (bill_participants, bill_items,
-- bill_payers, bill_splits, item_splits, ledger) handle cleanup automatically.

CREATE POLICY "creators_can_delete_own_drafts"
  ON public.bills
  FOR DELETE
  USING (
    creator_id = auth.uid()
    AND status = 'draft'
  );
