-- Composite indexes for hot read paths flagged by the 2026-05-16 audit.
--
-- All four queries below were doing two index scans + a merge, or scanning
-- past zero rows. Each new index narrows the planner's choice to one.

-- ============================================================
-- 1. expenses listed by group, filtered by status, ordered by recency
-- ============================================================
-- Pattern: listGroupExpenses + bills page filters non-draft expenses for a
-- group ordered DESC. The existing single-column indexes on group_id,
-- status, and created_at each cover one filter; a composite covers all
-- three with no sort step.

CREATE INDEX IF NOT EXISTS idx_expenses_group_status_created
  ON public.expenses (group_id, status, created_at DESC);

-- ============================================================
-- 2. settlements between a pair within a group, ordered by recency
-- ============================================================
-- Pattern: confirmation / history queries match (group_id, from_user_id,
-- to_user_id) and sort DESC. Splitwise-style pair history is the hottest
-- path on the conversations surface.

CREATE INDEX IF NOT EXISTS idx_settlements_pair_created
  ON public.settlements (group_id, from_user_id, to_user_id, created_at DESC);

-- ============================================================
-- 3. balances non-zero per user
-- ============================================================
-- Pattern: queryBalances / fetchUserDebts filter (user_a = $1 OR user_b = $1)
-- AND amount_cents != 0. The OR forces two scans, and existing indexes
-- include all rows including settled (amount_cents = 0). Partial indexes
-- on each side, restricted to non-zero rows, give the planner two cheap
-- bitmap scans it can OR.

CREATE INDEX IF NOT EXISTS idx_balances_user_a_active
  ON public.balances (user_a)
  WHERE amount_cents != 0;

CREATE INDEX IF NOT EXISTS idx_balances_user_b_active
  ON public.balances (user_b)
  WHERE amount_cents != 0;

-- ============================================================
-- 4. dm_pairs lookup by user_b
-- ============================================================
-- The unique constraint on (user_a, user_b) implicitly indexes user_a only.
-- All dm_pairs lookups are .or("user_a.eq.X, user_b.eq.X"). Without an
-- index on user_b, the user_b branch falls back to a seq scan.

CREATE INDEX IF NOT EXISTS idx_dm_pairs_user_b
  ON public.dm_pairs (user_b);
