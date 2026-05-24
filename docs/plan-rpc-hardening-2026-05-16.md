# Plan: RPC hardening (S3 + S4) — 2026-05-16

## Summary

One new migration redefines two `SECURITY DEFINER` RPCs to close two distinct
race / authorization gaps surfaced by the audit:

- **S3** — `public.claim_guest_spot` reads the parent expense row without a
  row lock. It races against `activate_expense`, which `SELECT ... FOR UPDATE`s
  the same row. Fix by acquiring `FOR UPDATE` on the `public.expenses` row
  immediately after locking `public.expense_guests`.
- **S4** — `public.confirm_settlement` only checks `to_user_id = auth.uid()`.
  A user removed from the settlement's group between creation and confirmation
  can still mutate `public.balances`. Fix by adding an
  accepted-membership check against `public.my_accepted_group_ids()`.

Both functions stay `SECURITY DEFINER` with `SET search_path = ''` and fully
qualified identifiers, matching the convention established by
`20260412010000_rls_hardening.sql` and reinforced by `20260418200000_rls_audit_hardening.sql`.

## Files to read / modify

- Read (latest definitions, lines 457-509 and 519-645):
  `supabase/migrations/20260412010000_rls_hardening.sql`
- Read (helper, defined here): `supabase/migrations/20260328175000_expense_rls_accepted_only.sql`
- Read (RPC convention for membership gate, mirror this style): `supabase/migrations/20260401400000_record_and_settle_accepted_membership.sql`
- Modify (existing tests to extend):
  - `src/lib/supabase/guest-tables.integration.test.ts` (already has a `claim_guest_spot RPC` describe block from line 368)
  - `src/lib/supabase/settlement-actions.integration.test.ts` (already has `confirm_settlement end-to-end` block from line 247)
- New file: `supabase/migrations/20260516120000_rpc_hardening_claim_lock_and_settlement_membership.sql`

## Latest function definitions confirmed

Reverse-chronological scan of every migration touching either symbol:

- `20260418200000_rls_audit_hardening.sql` — only references them in comments, no `CREATE OR REPLACE`.
- `20260412010000_rls_hardening.sql:457` — latest `confirm_settlement`.
- `20260412010000_rls_hardening.sql:519` — latest `claim_guest_spot`.
- Older: `20260401100000`, `20260330080000`, `20260329205000`, `20260328180000`.

Both are `SECURITY DEFINER`, both already `SET search_path = ''`, both already use `public.` schema prefixes.

## New migration

**Filename**: `20260516120000_rpc_hardening_claim_lock_and_settlement_membership.sql`

**Five most recent migrations** (confirm timestamp is later than all):
- `20260419000000_add_phone_to_pix_key_type.sql`
- `20260418200000_rls_audit_hardening.sql`
- `20260418100000_vendor_charges_rls_hardening.sql`
- `20260418000000_create_vendor_charges.sql`
- `20260414000000_add_notification_preferences.sql`

**Skeleton** (no SQL written here — implementation will copy each function body verbatim and apply the diffs below):

1. Header comment: link to audit findings S3 + S4 and migration `20260412010000` it supersedes.
2. `CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_claim_token uuid) RETURNS jsonb ... SECURITY DEFINER SET search_path = ''` — copy body from `20260412010000_rls_hardening.sql:519-645`. **Single diff**: at line ~572 change the read of `public.expenses` to append `FOR UPDATE` (alongside the existing `FOR UPDATE` on `public.expense_guests`). Preserve the `IF NOT FOUND` check that follows.
3. `CREATE OR REPLACE FUNCTION public.confirm_settlement(p_settlement_id uuid) RETURNS void ... SECURITY DEFINER SET search_path = ''` — copy body from `20260412010000_rls_hardening.sql:457-509`. **Single diff**: after the `to_user_id != auth.uid()` block (line ~481), before the `status != 'pending'` block, add `IF v_settlement.group_id NOT IN (SELECT public.my_accepted_group_ids()) THEN RAISE EXCEPTION 'permission_denied: ...'; END IF;`. Keep `RETURNS void`.

No grants needed — both functions are already executable; signatures don't change.

## Integration tests to add

**`src/lib/supabase/guest-tables.integration.test.ts`** (extend the existing `claim_guest_spot RPC` describe at line 368):

- Lock-acquisition test (deterministic, no real race): open two `pg` clients with the service-role pool (or use the existing admin client plus a second authenticated client). In a `BEGIN;` block, run `SELECT id FROM public.expenses WHERE id = $1 FOR UPDATE` on the expense, then call `claim_guest_spot` from another session with a short statement timeout — assert it blocks (timeout fires) until the first tx commits. This proves the new lock is being acquired without needing true concurrency.
- Balance-invariant test: activate an expense via `activate_expense`, then `claim_guest_spot` for a guest with a non-zero `share_amount_cents`. Read `balances` after; assert exactly one row per (caller, payer) pair, with `amount_cents` equal to the proportional delta — i.e. no double-counted row.

**`src/lib/supabase/settlement-actions.integration.test.ts`** (extend the existing `confirm_settlement end-to-end` describe at line 247):

- Removed-member rejection: alice + bob in a group; create + activate an expense; bob inserts a pending settlement; admin demotes bob's `group_members.status` to `removed` (or deletes the row); bob (still authenticated) calls `confirm_settlement` — assert error message matches `/permission_denied/`. Also assert that `balances` row for that pair is unchanged.
- Happy-path regression: keep the existing test green (no membership change → confirmation still succeeds, balance reaches zero).

Both files already import `createTestUsers`, `createTestGroupWithMembers`, `authenticateAs`, `getBalanceBetween`, and `adminClient` — no helper additions required.

## Risks / things to double-check during implementation

- **S3 deadlock ordering**: `activate_expense` locks `expenses` first, then writes child rows. `claim_guest_spot` currently locks `expense_guests` first. After the change it will lock `expense_guests` then `expenses` — verify `activate_expense` never locks `expense_guests` after `expenses` (skim `20260329210001_activate_expense_guest_shares.sql`). If it does, swap the lock order in `claim_guest_spot` to match.
- **S4 exception message**: match the existing convention `permission_denied: <human reason>` used at line 480 of the current definition and in `record_and_settle` (`20260401400000_record_and_settle_accepted_membership.sql:31`).
- `RETURNS void` for `confirm_settlement` is unchanged; `RETURNS jsonb` for `claim_guest_spot` is unchanged. Do not touch.
- The function bodies must be copied verbatim aside from the two targeted diffs — drift will reintroduce bugs the prior hardening fixed (search_path, schema prefixes, conflict resolution clauses).
- `my_accepted_group_ids()` is defined in `public` and is already invoked from other `SET search_path = ''` RPCs as `public.my_accepted_group_ids()` — use the same qualified form.

## Verification commands

```bash
supabase db reset                                  # apply all migrations cleanly
npm run test:integration -- guest-tables           # S3 cases
npm run test:integration -- settlement-actions     # S4 cases
npm run test:integration                           # full suite, no regressions
npm run lint && npm run build                      # type-check
```
