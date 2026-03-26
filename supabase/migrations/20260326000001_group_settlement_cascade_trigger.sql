-- Trigger to keep group_settlements.paid_amount_cents and group_settlements.status
-- in sync whenever a payment is inserted with group_settlement_id.
-- Mirrors update_ledger_on_payment() but for the group settlement flow.

CREATE OR REPLACE FUNCTION update_group_settlement_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  total_paid        INTEGER;
  settlement_amount INTEGER;
  new_status        debt_status;
BEGIN
  -- Only handle payments targeting a group settlement
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
