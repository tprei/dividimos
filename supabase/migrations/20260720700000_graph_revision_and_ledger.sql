-- Issue #477: graph_revision column + the expense_graph_save_operations
-- idempotency ledger. Both additive; no behavior change. graph_revision is a
-- database graph invariant (not only an RPC convention); the save-operation
-- ledger makes graph saves replay-safe and is the sole record of committed/
-- retired save operations.

-- expenses.graph_revision: monotonic per-expense CAS revision. Every existing
-- row reads zero (the foundation); new save returns 1, replacement/activation/
-- new claim each increment once; revision 2147483647 is exhausted.
ALTER TABLE public.expenses
  ADD COLUMN graph_revision integer NOT NULL DEFAULT 0;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_graph_revision_check
    CHECK (graph_revision BETWEEN 0 AND 2147483647);

-- expense_graph_save_operations: owner-only durable idempotency ledger.
-- RLS enabled without FORCE, no policies; every privilege revoked — only
-- owner-owned SECURITY DEFINER save/resolver/delete-trigger routines access it.
CREATE TABLE public.expense_graph_save_operations (
  operation_id      uuid        PRIMARY KEY,
  caller_id         uuid        NULL REFERENCES public.users(id)  ON DELETE RESTRICT,
  group_id          uuid        NULL REFERENCES public.groups(id) ON DELETE RESTRICT,
  canonical_request jsonb       NULL,
  request_digest    bytea       NULL CHECK (request_digest IS NULL OR octet_length(request_digest) = 32),
  outcome           text        NOT NULL CHECK (outcome IN ('committed', 'retired')),
  expense_id        uuid        NULL REFERENCES public.expenses(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  graph_revision    integer     NULL CHECK (graph_revision IS NULL OR graph_revision BETWEEN 0 AND 2147483647),
  result            jsonb       NULL,
  result_created_at timestamptz NULL,
  retired_reason    text        NULL CHECK (retired_reason IS NULL OR retired_reason IN ('resolved_absent', 'expense_deleted', 'group_deleted', 'account_deleted')),
  created_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  retired_at        timestamptz NULL,
  -- committed requires caller/group, a bounded canonical request, an expense +
  -- revision, an exact result, a result timestamp, and null retirement fields.
  CHECK (
    outcome <> 'committed'
    OR (
      caller_id IS NOT NULL
      AND group_id IS NOT NULL
      AND canonical_request IS NOT NULL
      AND expense_id IS NOT NULL
      AND graph_revision IS NOT NULL
      AND result IS NOT NULL
      AND result_created_at IS NOT NULL
      AND retired_reason IS NULL
      AND retired_at IS NULL
    )
  ),
  -- owner-bound retired/resolved_absent|expense_deleted keeps caller/group and
  -- requires every request/digest/expense/revision/result/timestamp null.
  CHECK (
    outcome <> 'retired'
    OR retired_reason IS NOT NULL
  ),
  CHECK (
    outcome <> 'retired'
    OR (retired_reason IN ('resolved_absent', 'expense_deleted'))
    OR (
      -- ownerless tombstones (group_deleted/account_deleted) also null caller/group.
      retired_reason IN ('group_deleted', 'account_deleted')
      AND caller_id IS NULL
      AND group_id IS NULL
    )
  )
);

CREATE INDEX ix_expense_graph_save_operations_live_expense
  ON public.expense_graph_save_operations (expense_id)
  WHERE outcome = 'committed';
CREATE INDEX ix_expense_graph_save_operations_live_caller_group
  ON public.expense_graph_save_operations (caller_id, group_id)
  WHERE outcome IN ('committed', 'retired');
CREATE INDEX ix_expense_graph_save_operations_group_retirement
  ON public.expense_graph_save_operations (group_id)
  WHERE outcome = 'retired' AND retired_reason IN ('group_deleted', 'account_deleted');

ALTER TABLE public.expense_graph_save_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.expense_graph_save_operations
  FROM PUBLIC, anon, authenticated, service_role;
