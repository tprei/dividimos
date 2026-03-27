-- Prevent lost-update race in payment triggers.
--
-- Two concurrent payment inserts for the same ledger entry (or group settlement)
-- each fire a trigger that reads SUM(payments) and writes the result. Without
-- locking, both triggers can read the same stale sum and one write gets lost.
--
-- Fix: SELECT ... FOR UPDATE on the parent row before summing. This serializes
-- concurrent triggers for the same entry while leaving unrelated entries unlocked.

-- 1. Ledger trigger — lock the ledger row before computing totals
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

  SELECT amount_cents
  INTO ledger_amount
  FROM ledger
  WHERE id = NEW.ledger_id
  FOR UPDATE;

  SELECT COALESCE(SUM(amount_cents), 0)
  INTO total_paid
  FROM payments
  WHERE ledger_id = NEW.ledger_id;

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

-- 2. Group settlement trigger — lock the settlement row before computing totals
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

  SELECT amount_cents
  INTO settlement_amount
  FROM group_settlements
  WHERE id = NEW.group_settlement_id
  FOR UPDATE;

  SELECT COALESCE(SUM(amount_cents), 0)
  INTO total_paid
  FROM payments
  WHERE group_settlement_id = NEW.group_settlement_id;

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
