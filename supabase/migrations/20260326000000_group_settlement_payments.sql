-- Extend payments table to support group settlement payments.
-- Currently payments only reference ledger entries. This migration adds
-- group_settlement_id so payments can record partial amounts against
-- group settlements, with a trigger to auto-update paid_amount_cents and status.

-- 1. Add nullable group_settlement_id column
ALTER TABLE payments
  ADD COLUMN group_settlement_id UUID REFERENCES group_settlements(id) ON DELETE CASCADE;

-- 2. Make ledger_id nullable (was NOT NULL)
ALTER TABLE payments ALTER COLUMN ledger_id DROP NOT NULL;

-- 3. Exactly one of ledger_id or group_settlement_id must be set
ALTER TABLE payments
  ADD CONSTRAINT payments_one_target CHECK (
    (ledger_id IS NOT NULL AND group_settlement_id IS NULL) OR
    (ledger_id IS NULL AND group_settlement_id IS NOT NULL)
  );

-- 4. Index for group settlement lookups
CREATE INDEX idx_payments_group_settlement_id ON payments(group_settlement_id)
  WHERE group_settlement_id IS NOT NULL;

-- 5. RLS: allow insert for group settlement payments
-- The debtor must match auth.uid() and the settlement must exist with matching users
CREATE POLICY "payments_insert_group_settlement"
  ON payments FOR INSERT
  WITH CHECK (
    group_settlement_id IS NOT NULL
    AND from_user_id = auth.uid()
    AND status = 'unconfirmed'
    AND EXISTS (
      SELECT 1 FROM group_settlements gs
      WHERE gs.id = group_settlement_id
        AND gs.from_user_id = from_user_id
        AND gs.to_user_id = to_user_id
    )
  );

-- 6. Trigger to update group_settlements on payment insert
CREATE OR REPLACE FUNCTION update_group_settlement_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  total_paid        INTEGER;
  settlement_amount INTEGER;
  new_status        debt_status;
BEGIN
  -- Only handle group settlement payments
  IF NEW.group_settlement_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0)
  INTO total_paid
  FROM payments
  WHERE group_settlement_id = NEW.group_settlement_id;

  SELECT amount_cents
  INTO settlement_amount
  FROM group_settlements
  WHERE id = NEW.group_settlement_id;

  IF total_paid >= settlement_amount THEN
    new_status := 'paid_unconfirmed';
  ELSE
    new_status := 'partially_paid';
  END IF;

  UPDATE group_settlements
  SET
    paid_amount_cents = LEAST(total_paid, settlement_amount),
    status            = new_status,
    paid_at           = COALESCE(paid_at, now())
  WHERE id = NEW.group_settlement_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER after_payment_insert_group_settlement
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_group_settlement_on_payment();

-- 7. Patch existing ledger trigger to skip when ledger_id is NULL
CREATE OR REPLACE FUNCTION update_ledger_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  total_paid    INTEGER;
  ledger_amount INTEGER;
  new_status    debt_status;
BEGIN
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
