-- Add group_settlement_id FK to payments table so payments can be recorded
-- against group settlements, not just individual ledger entries.

-- 1. Add nullable group_settlement_id column
ALTER TABLE payments
  ADD COLUMN group_settlement_id UUID REFERENCES group_settlements(id) ON DELETE CASCADE;

-- 2. Make ledger_id nullable (payments can now target either ledger or group_settlement)
ALTER TABLE payments
  ALTER COLUMN ledger_id DROP NOT NULL;

-- 3. Exactly one of ledger_id or group_settlement_id must be set
ALTER TABLE payments
  ADD CONSTRAINT payments_target_check
  CHECK (
    (ledger_id IS NOT NULL AND group_settlement_id IS NULL)
    OR (ledger_id IS NULL AND group_settlement_id IS NOT NULL)
  );

-- 4. Index for querying payments by group_settlement_id
CREATE INDEX idx_payments_group_settlement_id ON payments(group_settlement_id);

-- 5. Guard existing ledger trigger: skip when payment targets a group settlement
CREATE OR REPLACE FUNCTION update_ledger_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  total_paid    INTEGER;
  ledger_amount INTEGER;
  new_status    debt_status;
BEGIN
  -- Skip if this payment is against a group settlement, not a ledger entry
  IF NEW.ledger_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)
  INTO total_paid
  FROM payments
  WHERE ledger_id = NEW.ledger_id;

  SELECT amount_cents
  INTO ledger_amount
  FROM ledger
  WHERE id = NEW.ledger_id;

  IF total_paid >= ledger_amount THEN
    new_status := 'paid_unconfirmed';
  ELSE
    new_status := 'partially_paid';
  END IF;

  UPDATE ledger
  SET
    paid_amount_cents = LEAST(total_paid, ledger_amount),
    status            = new_status,
    paid_at           = COALESCE(paid_at, now())
  WHERE id = NEW.ledger_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update INSERT RLS policy to also allow payments against group settlements.
-- The debtor must match from_user_id and the creditor must match to_user_id.
DROP POLICY "payments_insert" ON payments;

CREATE POLICY "payments_insert"
  ON payments FOR INSERT
  WITH CHECK (
    from_user_id = auth.uid()
    AND status = 'unconfirmed'
    AND (
      -- Payment against a ledger entry
      (
        ledger_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ledger l
          WHERE l.id = ledger_id
            AND l.from_user_id = from_user_id
            AND l.to_user_id = to_user_id
        )
      )
      OR
      -- Payment against a group settlement
      (
        group_settlement_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM group_settlements gs
          WHERE gs.id = group_settlement_id
            AND gs.from_user_id = from_user_id
            AND gs.to_user_id = to_user_id
        )
      )
    )
  );
