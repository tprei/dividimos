# RLS hardening — Chains C, D, J (2026-05-18)

Closes the post-activation ledger fraud (Chain C), the system-message forgery
(Chain D), and the pending-settlement-after-leave (Chain J) findings from the
2026-05-18 deep bug hunt. Single PR, single migration, paired test updates.

## 1. Migration placement

5 most recent migrations on disk (lexicographic):

1. `supabase/migrations/20260516140000_composite_indexes_for_hot_queries.sql`
2. `supabase/migrations/20260516130000_dm_previews_and_unread_counts.sql`
3. `supabase/migrations/20260516120000_rpc_hardening_claim_lock_and_settlement_membership.sql`
4. `supabase/migrations/20260419000000_add_phone_to_pix_key_type.sql`
5. `supabase/migrations/20260418200000_rls_audit_hardening.sql`

New file:

```
supabase/migrations/20260518120000_rls_hardening_chains_cdj.sql
```

Skeleton:

```
-- Header comment block: bullet list of the three chains it closes, with
-- file:line callouts to the original sources.
-- Section 1 — expense child-table draft guards (Chain C)
-- Section 2 — chat_messages_insert message_type guard (Chain D)
-- Section 3 — confirm_settlement debtor membership guard (Chain J.1)
-- Section 4 — leave_group pending-settlement cleanup (Chain J.2)
```

The migration uses the established codebase pattern from
`supabase/migrations/20260328175000_expense_rls_accepted_only.sql` and
`supabase/migrations/20260412010000_rls_hardening.sql`:
`DROP POLICY IF EXISTS ... CREATE POLICY ...` (not `ALTER POLICY`). Each
`CREATE POLICY` explicitly states `TO authenticated` to match the role
binding used in `20260412010000_rls_hardening.sql:72,88,108,124`. The
original policies in `20260328175000_*.sql` and `20260329205000_*.sql` omit
`TO authenticated`, which defaults to `PUBLIC`. Re-creating them under
`TO authenticated` tightens role scope at the same time and matches the
project's current convention.

Each RPC is redefined with `CREATE OR REPLACE FUNCTION ... SECURITY DEFINER
SET search_path = ''` and qualified table names, consistent with the
2026-05-16 RPC hardening pass.

## 2. Chain C — expense child-table draft guards

Source of the gap: `supabase/migrations/20260328175000_expense_rls_accepted_only.sql:62-140`
(expense_items / expense_shares / expense_payers INSERT/UPDATE/DELETE) and
`supabase/migrations/20260329205000_create_guest_tables.sql:68-104`
(expense_guests, expense_guest_shares — the CREATE lives in the guest tables
migration, confirmed by grep).

Add a `status='draft'` predicate to every mutating policy on these five
child tables. The predicate goes in both `USING` (for UPDATE/DELETE) and
`WITH CHECK` (for INSERT/UPDATE) so a draft can't be flipped to active
while a write is mid-flight. Implementation form (described, not SQL):

> require an `EXISTS` selecting from `public.expenses` where
> `id = <child>.expense_id`, `creator_id = auth.uid()`, and `status =
> 'draft'`.

This subsumes the current `expense_id IN (SELECT id FROM expenses WHERE
creator_id = auth.uid())` clause — the new predicate carries both
ownership and draft state in one EXISTS, so no separate creator check is
needed.

Policies to DROP+CREATE (15 total):

- `expense_items_insert`, `expense_items_update`, `expense_items_delete`
- `expense_shares_insert`, `expense_shares_update`, `expense_shares_delete`
- `expense_payers_insert`, `expense_payers_update`, `expense_payers_delete`
- `expense_guests_insert`, `expense_guests_update`, `expense_guests_delete`
- `expense_guest_shares_insert`, `expense_guest_shares_update`,
  `expense_guest_shares_delete`

The corresponding `*_select` policies are unchanged — read access still
follows accepted membership.

Note on `claim_guest_spot`: the RPC runs as `SECURITY DEFINER` and bypasses
RLS, so it can still update `expense_guests` and insert `expense_shares`
on active expenses (the upgrade-from-guest flow). This is intentional and
the integration test for guest-on-active must keep passing.

Note on `expenses_update` itself: already draft-locked in
`supabase/migrations/20260412010000_rls_hardening.sql:121-133`. No change
needed.

## 3. Chain D — chat_messages_insert message_type guard

Source of the gap: `supabase/migrations/20260412010000_rls_hardening.sql:107-112`.

Drop and recreate `chat_messages_insert` with one extra `WITH CHECK`
predicate: `message_type = 'text'`. System types (`system_expense`,
`system_settlement`) are only ever inserted by `activate_expense` and
`record_and_settle`, both `SECURITY DEFINER` and therefore unaffected by
the policy.

Preserved predicates:

- `sender_id = auth.uid()`
- `group_id IN (SELECT public.my_accepted_group_ids())`
- `TO authenticated`

## 4. Chain J — pending-settlement reversal post-leave

Two coordinated changes.

### 4.1 `confirm_settlement` — debtor membership gate

Latest definition: `supabase/migrations/20260516120000_rpc_hardening_claim_lock_and_settlement_membership.sql:143-199`.

Redefine the function. After the existing creditor membership check at
line 169 (`v_settlement.group_id NOT IN (SELECT public.my_accepted_group_ids())`),
add a parallel check on the debtor:

> If `v_settlement.from_user_id` is not in the accepted-member set for
> `v_settlement.group_id`, raise `permission_denied: debtor is no longer
> a member of the group`.

Implementation note: `my_accepted_group_ids()` returns groups for
`auth.uid()`, not arbitrary users, so the debtor check uses a direct
`EXISTS` against `public.group_members` with
`status='accepted'`, OR against `public.groups.creator_id` (mirroring the
union inside `my_accepted_group_ids`, defined in
`20260328175000_expense_rls_accepted_only.sql:9-21`).

All other guards remain bit-identical: settlement lookup with `FOR UPDATE`,
payee match (`to_user_id != auth.uid()`), creditor group membership,
status='pending' check, balance upsert, status flip. No behavioral drift.

### 4.2 `leave_group` — delete pending settlements involving the leaver

Latest definition: `supabase/migrations/20260401500000_leave_group_rpc.sql:13-72`.

Redefine the function. After the `has_outstanding_balance` check (line 58)
and before the zero-balance DELETE (line 63), add one DELETE:

> Delete from `public.settlements` where `group_id = p_group_id`,
> `status = 'pending'`, and (`from_user_id = v_caller` OR
> `to_user_id = v_caller`).

The `chat_messages.settlement_id` FK is `ON DELETE SET NULL` (confirmed
at `supabase/migrations/20260411000000_create_chat_messages.sql:36`), so
deleting settlements nulls the FK on any `system_settlement` chat row but
leaves the message visible in the DM thread — correct audit-trail
behavior.

`has_outstanding_balance` runs before this DELETE, so if the leaver has a
confirmed-balance row (non-zero) they're blocked before any settlement
cleanup happens. Pending settlements alone don't move the balance row,
so they don't block the leave; cleanup is required to prevent the Chain J
exploit.

All other guards remain: not-creator, accepted-only membership, zero-
balance row cleanup, group_members DELETE.

## 5. Tests to remove and replace

### 5.1 chat-messages.integration.test.ts

`src/lib/supabase/chat-messages.integration.test.ts:83-98` — the
`allows system_expense message with expense_id` case currently asserts
the forgery succeeds. Delete it. Replace with:

> `rejects direct insert of system_settlement message_type` — accepted
> member tries to INSERT `{message_type: 'system_settlement',
> sender_id: alice.id, group_id: dmGroupId, content: 'fake'}` via the
> authenticated client; expect the insert to fail with an RLS error.

A second replacement case can cover `system_expense` symmetrically.

### 5.2 group-membership.integration.test.ts

`src/lib/supabase/group-membership.integration.test.ts:817-823` — the
both-branches-pass block. Remove it. The accompanying comment block on
lines 812-816 also goes.

Note: this test exercises `record_and_settle`, not the policies changed
by this migration. The "invited member CAN settle" behavior remains
intact in `record_and_settle` (its predicate is still
`my_accepted_group_ids()` per `20260412010000_rls_hardening.sql:209`).
The test is broken because its assertion shape covers both outcomes; the
fix is to make the assertion strict against the current
behavior:

> `if (error)` → strict pass with `expect.fail()` (current behavior is
> success).
> `else` → keep the success assertion.

This is a test hygiene fix only, not a behavior change. If the team
wants to also tighten `record_and_settle` to accepted-only in a follow-up,
that's a separate migration.

## 6. Integration tests to add

Per the CLAUDE.md migration test requirement (RPC + RLS changes require
behavior coverage), new cases:

1. **expense child-table draft guard** — extend
   `src/lib/supabase/expense-actions.integration.test.ts` (or a new
   `expense-rls-draft.integration.test.ts` if one doesn't exist):
   - Alice creates and activates an expense via `activate_expense`.
   - Alice authenticated client attempts to UPDATE
     `expense_shares.share_amount_cents` on the active expense.
   - Expect RLS denial (update affects zero rows, or returns an error
     depending on PostgREST version — assert `data` is empty / not the
     mutated value).
   - Same shape for `expense_items`, `expense_payers`,
     `expense_guest_shares`, `expense_guests` (one assertion per table
     is plenty; the predicate is identical).

2. **chat_messages_insert message_type guard** — extend
   `src/lib/supabase/chat-messages.integration.test.ts`:
   - Accepted member authenticated client tries to INSERT
     `message_type='system_settlement'`. Expect error.
   - Accepted member INSERTs `message_type='text'`. Expect success
     (regression guard).

3. **confirm_settlement debtor membership** — new
   `src/lib/supabase/settlement-actions.integration.test.ts` cases or
   extend the existing settlement test file:
   - Alice creates a group, adds Bob (accepted).
   - Bob calls `recordSettlement` (debtor=Bob, creditor=Alice).
   - Alice removes Bob via `remove_group_member`.
   - Alice calls `confirm_settlement` → expect error
     `permission_denied: debtor is no longer a member`.

4. **leave_group cleans up pending settlements** — same file:
   - Alice creates a group, adds Bob (accepted).
   - Bob calls `recordSettlement` (debtor=Bob, creditor=Alice).
   - Bob calls `leave_group`.
   - Assert: the pending settlement row is gone.
   - Assert: any `system_settlement` chat_message that referenced it
     still exists with `settlement_id IS NULL`.

## 7. Risks and open questions

- **Fixture audit**: scan every `*.integration.test.ts` for direct
  authenticated-client INSERTs to `expense_items / expense_shares /
  expense_payers / expense_guests / expense_guest_shares` that target an
  expense whose status is `active`. Any such fixture breaks under the
  new policy. `adminClient` writes bypass RLS and remain fine. The most
  likely offenders are tests that mutate shares post-activation to
  simulate edits — those tests are now actively asserting a bug and
  must be deleted or rewritten to go through a draft.

- **Fixture audit (chat_messages)**: same scan for authenticated-client
  INSERTs of `system_expense` / `system_settlement` rows. Replace with
  admin-client inserts (RLS bypass) wherever the test only needs to seed
  data, not exercise the policy.

- **`confirm_settlement` guard ordering**: keep the debtor membership
  check after the creditor check and after `status='pending'`. Reordering
  changes the exception code surfaced to the client and may break
  product copy mapping in `settlement-actions.ts`.

- **`leave_group` DELETE scope**: the DELETE filters on
  `status='pending'`. Confirmed settlements are immutable history and
  must not be touched. Verify the constant matches the schema enum in
  `supabase/migrations/20260326000000_group_settlement_payments.sql`
  before merging.

- **`TO authenticated` upgrade**: re-creating the expense child policies
  under `TO authenticated` is a real behavior change for any anonymous
  / `anon` client. None of the app code uses anon writes against these
  tables, but flagging for the reviewer.

- **Realtime publication**: none of these changes alter the publication
  set. No realtime impact expected.

## 8. Verification commands

```
# Apply migration locally and rerun the full integration suite
supabase db reset
npm run test:integration -- src/lib/supabase/expense-actions.integration.test.ts
npm run test:integration -- src/lib/supabase/chat-messages.integration.test.ts
npm run test:integration -- src/lib/supabase/group-membership.integration.test.ts
npm run test:integration -- src/lib/supabase/settlement-actions.integration.test.ts
npm run test:integration

# Type + lint gates
npm run build
npm run lint
```

## 9. PR shape

Single PR. Commit layout:

1. `feat(db): RLS hardening for Chains C, D, J` — migration only.
2. `test(rls): cover draft guards, message_type, confirm_settlement,
   leave_group cleanup` — test additions + removals.

Both commits land together; the migration cannot be merged without the
test updates because the chat-messages test on line 83-98 starts failing
immediately under the new policy.
