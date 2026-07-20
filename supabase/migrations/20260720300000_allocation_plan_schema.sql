-- Issue #468: persisted participant map and exact allocation plan tables.
-- Additive schema only (no behavior change). The activation/claim rewrite,
-- the internal allocation builder, and the historical balance rebuild land in
-- follow-on slices. RLS is enabled with no policies and every direct privilege
-- is revoked: only trusted SECURITY DEFINER graph writers (and the owner)
-- access these tables; clients never read map/plan rows.

-- ============================================================
-- Participant map: one entity per ordered participant per expense.
-- ============================================================
CREATE TABLE public.expense_allocation_entities (
  expense_id          uuid     NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  participant_index   integer  NOT NULL CHECK (participant_index > 0),
  entity_kind         text     NOT NULL CHECK (entity_kind IN ('user', 'guest')),
  user_id             uuid,
  guest_id            uuid,
  share_amount_cents  integer  NOT NULL CHECK (share_amount_cents >= 0),
  payer_amount_cents  integer  NOT NULL CHECK (payer_amount_cents >= 0),
  net_amount_cents    integer  NOT NULL,
  PRIMARY KEY (expense_id, participant_index),
  -- Exactly one of user_id / guest_id is set.
  CHECK ((user_id IS NOT NULL)::integer + (guest_id IS NOT NULL)::integer = 1),
  -- kind matches which id is set; guests never pay.
  CHECK (
    (entity_kind = 'user'  AND user_id  IS NOT NULL AND guest_id IS NULL)
    OR
    (entity_kind = 'guest' AND guest_id IS NOT NULL AND user_id IS NULL AND payer_amount_cents = 0)
  ),
  -- net is derived from share minus payer (exact integer incidence).
  CHECK (net_amount_cents = share_amount_cents - payer_amount_cents)
);

CREATE UNIQUE INDEX uq_expense_allocation_entities_user
  ON public.expense_allocation_entities (expense_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX uq_expense_allocation_entities_guest
  ON public.expense_allocation_entities (expense_id, guest_id)
  WHERE guest_id IS NOT NULL;

-- ============================================================
-- Plan header: one immutable plan per activated expense.
-- ============================================================
CREATE TABLE public.expense_balance_allocation_plans (
  expense_id        uuid     PRIMARY KEY REFERENCES public.expenses(id) ON DELETE CASCADE,
  algorithm_version smallint NOT NULL CHECK (algorithm_version = 1),
  total_cents       integer  NOT NULL CHECK (total_cents > 0),
  entity_count      integer  NOT NULL CHECK (entity_count > 0),
  edge_count        integer  NOT NULL CHECK (edge_count >= 0),
  source_digest     text     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Plan edges: debtor -> creditor integer-cent obligations.
-- ============================================================
CREATE TABLE public.expense_balance_allocations (
  expense_id          uuid     NOT NULL REFERENCES public.expense_balance_allocation_plans(expense_id) ON DELETE CASCADE,
  allocation_index    integer  NOT NULL CHECK (allocation_index > 0),
  debtor_index        integer  NOT NULL,
  creditor_index      integer  NOT NULL,
  amount_cents        integer  NOT NULL CHECK (amount_cents > 0),
  applied_to_user_id  uuid,
  applied_at          timestamptz,
  PRIMARY KEY (expense_id, allocation_index),
  UNIQUE (expense_id, debtor_index, creditor_index),
  FOREIGN KEY (expense_id, debtor_index)
    REFERENCES public.expense_allocation_entities(expense_id, participant_index),
  FOREIGN KEY (expense_id, creditor_index)
    REFERENCES public.expense_allocation_entities(expense_id, participant_index),
  CHECK (debtor_index <> creditor_index),
  CHECK (
    (applied_to_user_id IS NULL AND applied_at IS NULL)
    OR (applied_to_user_id IS NOT NULL AND applied_at IS NOT NULL)
  )
);

CREATE INDEX ix_expense_balance_allocations_debtor
  ON public.expense_balance_allocations (expense_id, debtor_index, allocation_index);

-- ============================================================
-- RLS: enabled, no policies, no direct grants. Only trusted graph writers
-- (owner-owned SECURITY DEFINER) read/write these tables.
-- ============================================================
ALTER TABLE public.expense_allocation_entities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_balance_allocation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_balance_allocations    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.expense_allocation_entities    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.expense_balance_allocation_plans FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.expense_balance_allocations    FROM PUBLIC, anon, authenticated, service_role;
