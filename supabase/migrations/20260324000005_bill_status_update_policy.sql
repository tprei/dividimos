-- Allow participants to update bill status (for settlement tracking)
CREATE POLICY "participants_update_bill_status"
  ON bills FOR UPDATE
  USING (id IN (SELECT public.my_bill_ids()))
  WITH CHECK (id IN (SELECT public.my_bill_ids()));

-- Auto-update bill status when all ledger entries are settled
CREATE OR REPLACE FUNCTION public.check_bill_settled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  pending_count INTEGER;
  any_settled BOOLEAN;
BEGIN
  IF NEW.status = 'settled' THEN
    SELECT COUNT(*) INTO pending_count
    FROM public.ledger
    WHERE bill_id = NEW.bill_id AND status != 'settled';

    IF pending_count = 0 THEN
      UPDATE public.bills SET status = 'settled' WHERE id = NEW.bill_id;
    ELSE
      SELECT EXISTS(SELECT 1 FROM public.ledger WHERE bill_id = NEW.bill_id AND status = 'settled') INTO any_settled;
      IF any_settled THEN
        UPDATE public.bills SET status = 'partially_settled' WHERE id = NEW.bill_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_status_change
  AFTER UPDATE OF status ON ledger
  FOR EACH ROW EXECUTE FUNCTION public.check_bill_settled();

-- bills already in supabase_realtime from initial migration
