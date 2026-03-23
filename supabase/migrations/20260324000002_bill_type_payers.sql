-- Add missing columns to bills table
ALTER TABLE bills ADD COLUMN IF NOT EXISTS bill_type TEXT NOT NULL DEFAULT 'itemized';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS total_amount_input INTEGER NOT NULL DEFAULT 0;

-- Bill payers table (who paid and how much)
CREATE TABLE bill_payers (
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  PRIMARY KEY (bill_id, user_id)
);

ALTER TABLE bill_payers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bill_payers_select" ON bill_payers FOR SELECT
  USING (bill_id IN (SELECT public.my_bill_ids()));
CREATE POLICY "bill_payers_manage" ON bill_payers FOR ALL
  USING (bill_id IN (SELECT id FROM bills WHERE creator_id = auth.uid()));

-- Bill splits table (for single_amount bill splits)
CREATE TABLE bill_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  split_type TEXT NOT NULL DEFAULT 'equal',
  value NUMERIC(10,4) NOT NULL,
  computed_amount_cents INTEGER NOT NULL,
  UNIQUE (bill_id, user_id)
);

ALTER TABLE bill_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bill_splits_select" ON bill_splits FOR SELECT
  USING (bill_id IN (SELECT public.my_bill_ids()));
CREATE POLICY "bill_splits_manage" ON bill_splits FOR ALL
  USING (bill_id IN (SELECT id FROM bills WHERE creator_id = auth.uid()));

-- Allow creators to insert ledger entries
CREATE POLICY "ledger_insert" ON ledger FOR INSERT
  WITH CHECK (bill_id IN (SELECT id FROM bills WHERE creator_id = auth.uid()));

-- Allow creators to manage participants
DROP POLICY IF EXISTS "Creators can manage participants" ON bill_participants;
CREATE POLICY "bill_participants_manage" ON bill_participants FOR ALL
  USING (bill_id IN (SELECT id FROM bills WHERE creator_id = auth.uid()));

-- Allow creators to manage items
DROP POLICY IF EXISTS "Creators can manage items" ON bill_items;
CREATE POLICY "bill_items_manage" ON bill_items FOR ALL
  USING (bill_id IN (SELECT id FROM bills WHERE creator_id = auth.uid()));

-- Allow creators to manage splits
DROP POLICY IF EXISTS "Creators can manage splits" ON item_splits;
CREATE POLICY "item_splits_manage" ON item_splits FOR ALL
  USING (
    item_id IN (
      SELECT bi.id FROM bill_items bi
      JOIN bills b ON b.id = bi.bill_id
      WHERE b.creator_id = auth.uid()
    )
  );

CREATE INDEX idx_bill_payers_bill ON bill_payers(bill_id);
CREATE INDEX idx_bill_splits_bill ON bill_splits(bill_id);
