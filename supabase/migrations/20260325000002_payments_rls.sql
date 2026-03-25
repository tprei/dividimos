-- RLS policies for the payments table
-- Mirrors ledger access patterns: debtor inserts, creditor confirms

-- SELECT: Both parties of a payment can read it
CREATE POLICY "payments_select"
  ON payments FOR SELECT
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

-- INSERT: Only the debtor (from_user_id) can create a payment,
-- and the payment must reference a ledger entry where they are the debtor
-- and the creditor matches. Status must start as 'unconfirmed'.
CREATE POLICY "payments_insert"
  ON payments FOR INSERT
  WITH CHECK (
    from_user_id = auth.uid()
    AND status = 'unconfirmed'
    AND EXISTS (
      SELECT 1 FROM ledger l
      WHERE l.id = ledger_id
        AND l.from_user_id = from_user_id
        AND l.to_user_id = to_user_id
    )
  );

-- UPDATE (confirm): Only the creditor (to_user_id) can confirm a payment
CREATE POLICY "payments_confirm"
  ON payments FOR UPDATE
  USING (to_user_id = auth.uid() AND status = 'unconfirmed')
  WITH CHECK (status = 'settled');
