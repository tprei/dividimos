-- New Splitwise-style expense tables.
-- These replace the old bill/ledger/payment/group_settlement system
-- with a single unified model where every expense belongs to a group
-- and running balances are maintained per (group, user_pair).
--
-- The old tables (bills, bill_items, bill_splits, bill_payers,
-- bill_participants, ledger, payments, group_settlements) will be
-- dropped in a separate migration after the new system is live.

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE expense_status AS ENUM ('draft', 'active', 'settled');
CREATE TYPE expense_type AS ENUM ('itemized', 'single_amount');
CREATE TYPE settlement_status AS ENUM ('pending', 'confirmed');

-- ============================================================
-- EXPENSES (replaces bills)
-- ============================================================
-- Every expense belongs to a group. 1-on-1 expenses use a
-- two-person group (auto-created by the app, like Splitwise).

CREATE TABLE expenses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  creator_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  merchant_name   text,
  expense_type    expense_type NOT NULL DEFAULT 'itemized',
  total_amount    integer     NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  service_fee_percent numeric(5,2) NOT NULL DEFAULT 0,
  fixed_fees      integer     NOT NULL DEFAULT 0 CHECK (fixed_fees >= 0),
  status          expense_status NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_group_id   ON expenses(group_id);
CREATE INDEX idx_expenses_creator_id ON expenses(creator_id);
CREATE INDEX idx_expenses_created_at ON expenses(created_at);
CREATE INDEX idx_expenses_status     ON expenses(status);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_expenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_expenses_updated_at();

-- ============================================================
-- EXPENSE_ITEMS (replaces bill_items)
-- ============================================================
-- Line items within an itemized expense. For single_amount
-- expenses, no items are created.

CREATE TABLE expense_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id       uuid        NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  description      text        NOT NULL,
  quantity         integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents integer     NOT NULL CHECK (unit_price_cents >= 0),
  total_price_cents integer    NOT NULL CHECK (total_price_cents >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_items_expense_id ON expense_items(expense_id);

-- ============================================================
-- EXPENSE_SHARES (who consumed / owes what)
-- ============================================================
-- Each row represents a user's share of an expense.
-- share_amount_cents is the total this user owes for the expense
-- (computed from items + fees, or from equal split of total).
-- This is the final computed amount — item-level detail is in
-- expense_items for display only.

CREATE TABLE expense_shares (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id          uuid    NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id             uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_amount_cents  integer NOT NULL CHECK (share_amount_cents >= 0),
  UNIQUE(expense_id, user_id)
);

CREATE INDEX idx_expense_shares_expense_id ON expense_shares(expense_id);
CREATE INDEX idx_expense_shares_user_id    ON expense_shares(user_id);

-- ============================================================
-- EXPENSE_PAYERS (who paid)
-- ============================================================
-- Records who actually paid for the expense and how much.
-- Multiple payers allowed (split the check).

CREATE TABLE expense_payers (
  expense_id  uuid    NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (expense_id, user_id)
);

CREATE INDEX idx_expense_payers_expense_id ON expense_payers(expense_id);
CREATE INDEX idx_expense_payers_user_id    ON expense_payers(user_id);

-- ============================================================
-- BALANCES (running net balance per group pair)
-- ============================================================
-- Stores the net amount between two users within a group.
-- Convention: user_a < user_b (UUID ordering) — canonical form
-- to avoid duplicate pairs.
--
-- Positive amount_cents = user_a owes user_b
-- Negative amount_cents = user_b owes user_a
-- Zero = settled
--
-- Updated atomically by activate_expense and record_settlement
-- RPC functions (created in a separate migration).

CREATE TABLE balances (
  group_id     uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_a       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE INDEX idx_balances_group_id ON balances(group_id);
CREATE INDEX idx_balances_user_a   ON balances(user_a);
CREATE INDEX idx_balances_user_b   ON balances(user_b);

-- ============================================================
-- SETTLEMENTS (records of payments between users)
-- ============================================================
-- When user_a pays user_b to settle a debt, a settlement is
-- created. On confirmation, the balances table is updated.

CREATE TABLE settlements (
  id            uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid              NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user_id  uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents  integer           NOT NULL CHECK (amount_cents > 0),
  status        settlement_status NOT NULL DEFAULT 'pending',
  created_at    timestamptz       NOT NULL DEFAULT now(),
  confirmed_at  timestamptz
);

CREATE INDEX idx_settlements_group_id     ON settlements(group_id);
CREATE INDEX idx_settlements_from_user_id ON settlements(from_user_id);
CREATE INDEX idx_settlements_to_user_id   ON settlements(to_user_id);
CREATE INDEX idx_settlements_status       ON settlements(status);
CREATE INDEX idx_settlements_created_at   ON settlements(created_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- Helper: all group_ids the current user belongs to (accepted)
-- Reuses existing my_group_ids() function from prior migrations.

-- Expenses: group members can read; creator can insert/update/delete
CREATE POLICY expenses_select ON expenses
  FOR SELECT USING (group_id IN (SELECT my_group_ids()));

CREATE POLICY expenses_insert ON expenses
  FOR INSERT WITH CHECK (creator_id = auth.uid() AND group_id IN (SELECT my_group_ids()));

CREATE POLICY expenses_update ON expenses
  FOR UPDATE USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY expenses_delete ON expenses
  FOR DELETE USING (creator_id = auth.uid());

-- Expense items: group members can read; creator can manage
CREATE POLICY expense_items_select ON expense_items
  FOR SELECT USING (
    expense_id IN (SELECT id FROM expenses WHERE group_id IN (SELECT my_group_ids()))
  );

CREATE POLICY expense_items_insert ON expense_items
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_items_update ON expense_items
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_items_delete ON expense_items
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- Expense shares: group members can read; creator can manage
CREATE POLICY expense_shares_select ON expense_shares
  FOR SELECT USING (
    expense_id IN (SELECT id FROM expenses WHERE group_id IN (SELECT my_group_ids()))
  );

CREATE POLICY expense_shares_insert ON expense_shares
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_shares_update ON expense_shares
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_shares_delete ON expense_shares
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- Expense payers: group members can read; creator can manage
CREATE POLICY expense_payers_select ON expense_payers
  FOR SELECT USING (
    expense_id IN (SELECT id FROM expenses WHERE group_id IN (SELECT my_group_ids()))
  );

CREATE POLICY expense_payers_insert ON expense_payers
  FOR INSERT WITH CHECK (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_payers_update ON expense_payers
  FOR UPDATE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

CREATE POLICY expense_payers_delete ON expense_payers
  FOR DELETE USING (
    expense_id IN (SELECT id FROM expenses WHERE creator_id = auth.uid())
  );

-- Balances: group members can read (writes are via RPC only)
CREATE POLICY balances_select ON balances
  FOR SELECT USING (group_id IN (SELECT my_group_ids()));

-- Settlements: group members can read; from_user can insert
CREATE POLICY settlements_select ON settlements
  FOR SELECT USING (group_id IN (SELECT my_group_ids()));

CREATE POLICY settlements_insert ON settlements
  FOR INSERT WITH CHECK (
    from_user_id = auth.uid()
    AND group_id IN (SELECT my_group_ids())
  );

-- ============================================================
-- REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE balances;
ALTER PUBLICATION supabase_realtime ADD TABLE settlements;
