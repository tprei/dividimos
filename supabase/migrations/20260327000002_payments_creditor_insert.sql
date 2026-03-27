-- Allow creditor to insert payments for bill ledger entries.
-- Completes the removal of the confirmation flow — both parties
-- can now record payments for ledger debts, not just group settlements.

CREATE POLICY "payments_insert_ledger_creditor"
  ON payments FOR INSERT
  WITH CHECK (
    ledger_id IS NOT NULL
    AND to_user_id = auth.uid()
    AND status = 'unconfirmed'
    AND EXISTS (
      SELECT 1 FROM ledger l
      WHERE l.id = ledger_id
        AND l.from_user_id = from_user_id
        AND l.to_user_id = to_user_id
    )
  );

-- The old confirmation UPDATE policy is dead — status changes happen
-- via SECURITY DEFINER triggers only. Drop it.
DROP POLICY IF EXISTS "payments_confirm" ON payments;
