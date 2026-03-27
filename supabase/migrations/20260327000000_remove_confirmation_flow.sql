-- Remove the confirmation step from settlements.
-- Both debtor and creditor can record payments. When total paid >= amount,
-- the settlement transitions directly to 'settled' (skipping 'paid_unconfirmed').

-- 1. Update group settlement trigger: paid_unconfirmed → settled
CREATE OR REPLACE FUNCTION update_group_settlement_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  total_paid        INTEGER;
  settlement_amount INTEGER;
  new_status        debt_status;
BEGIN
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
    new_status := 'settled';
  ELSE
    new_status := 'partially_paid';
  END IF;

  UPDATE group_settlements
  SET
    paid_amount_cents = LEAST(total_paid, settlement_amount),
    status            = new_status,
    paid_at           = COALESCE(paid_at, now()),
    confirmed_at      = CASE WHEN total_paid >= settlement_amount THEN now() ELSE confirmed_at END
  WHERE id = NEW.group_settlement_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Update ledger trigger: paid_unconfirmed → settled
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
    new_status := 'settled';
  ELSE
    new_status := 'partially_paid';
  END IF;

  UPDATE ledger
  SET
    paid_amount_cents = LEAST(total_paid, ledger_amount),
    status            = new_status,
    paid_at           = COALESCE(paid_at, now()),
    confirmed_at      = CASE WHEN total_paid >= ledger_amount THEN now() ELSE confirmed_at END
  WHERE id = NEW.ledger_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Allow creditor (to_user_id) to insert payments for group settlements
CREATE POLICY "payments_insert_group_settlement_creditor"
  ON payments FOR INSERT
  WITH CHECK (
    group_settlement_id IS NOT NULL
    AND to_user_id = auth.uid()
    AND status = 'unconfirmed'
    AND EXISTS (
      SELECT 1 FROM group_settlements gs
      WHERE gs.id = group_settlement_id
        AND gs.from_user_id = from_user_id
        AND gs.to_user_id = to_user_id
    )
  );

-- 4. Drop old UPDATE policies — status changes happen via SECURITY DEFINER triggers only
DROP POLICY IF EXISTS "group_settlements_mark_paid" ON group_settlements;
DROP POLICY IF EXISTS "group_settlements_confirm" ON group_settlements;

-- 5. Migrate any existing paid_unconfirmed rows to settled
UPDATE group_settlements
SET status = 'settled', confirmed_at = COALESCE(confirmed_at, now())
WHERE status = 'paid_unconfirmed';

UPDATE ledger
SET status = 'settled', confirmed_at = COALESCE(confirmed_at, now())
WHERE status = 'paid_unconfirmed';
