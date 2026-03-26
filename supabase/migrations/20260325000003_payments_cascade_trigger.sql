-- Trigger to keep ledger.paid_amount_cents and ledger.status in sync
-- whenever a row is inserted into the payments table.
-- This makes recordPaymentInSupabase a simple insert — no manual ledger update needed.

CREATE OR REPLACE FUNCTION update_ledger_on_payment()
RETURNS TRIGGER AS $$
DECLARE
  total_paid    INTEGER;
  ledger_amount INTEGER;
  new_status    debt_status;
BEGIN
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

CREATE TRIGGER after_payment_insert
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_ledger_on_payment();
