-- Add 'partially_paid' to debt_status enum
ALTER TYPE debt_status ADD VALUE IF NOT EXISTS 'partially_paid' AFTER 'pending';

-- Create payment_status enum for individual payment records
CREATE TYPE payment_status AS ENUM ('unconfirmed', 'settled');

-- Payments table: records individual (possibly partial) payments against a ledger entry
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id UUID NOT NULL REFERENCES ledger(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status payment_status NOT NULL DEFAULT 'unconfirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

-- Add paid_amount_cents to ledger for quick balance lookups
ALTER TABLE ledger ADD COLUMN paid_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0);

-- Add paid_amount_cents to group_settlements for the same reason
ALTER TABLE group_settlements ADD COLUMN paid_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_cents >= 0);

-- Indexes for common queries
CREATE INDEX idx_payments_ledger_id ON payments(ledger_id);
CREATE INDEX idx_payments_from_user_id ON payments(from_user_id);
CREATE INDEX idx_payments_to_user_id ON payments(to_user_id);
CREATE INDEX idx_payments_status ON payments(status);

-- Enable RLS (policies are handled by another task)
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
