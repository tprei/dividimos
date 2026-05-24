# Account deletion — design notes (not yet implemented)

Discussed 2026-05-16. Captured here as a reference for whenever account-deletion lands on the product roadmap. **Not implemented.** This file is intentionally untracked.

## Model: synchronous soft-delete via `redact_user`

No cron. No restore window. PII cleared at the moment of redact.

### `redact_user(p_user_id uuid)` RPC

Caller must be the user themselves (or service-role). Behavior:

- Set `deleted_at = now()` on `public.users`
- Rewrite `handle` to `removed_<short_id>` so the original handle is reclaimable by someone else
- Rewrite `name` to `<original_name> (removida)` (frozen at redact time; counterparty history reads as e.g. "Alice Silva (removida)")
- Clear: `email`, `pix_key_encrypted`, `pix_key_hint`, `avatar_url`, `notification_preferences`
- Leave intact: `id`, `created_at`, all FK rows in `expense_payers`, `balances`, `settlements`, `expense_shares`, `group_members`, `chat_messages`, etc.
- Leave intact: the linked `auth.users` row

The row stays in `public.users` forever for FK integrity. Bob's settled history with Alice keeps rendering correctly because `name` is preserved-with-marker.

### Returning user

Same Google account signs in → same `auth.uid()` → finds the soft-deleted row.

- The post-signup trigger (or onboarding page) detects `deleted_at IS NOT NULL`
- Routes the user through the standard onboarding flow (same screens as new signup — name, handle, Pix key)
- On submit, the onboarding action clears `deleted_at` and updates name/handle/pix_key fields
- Group memberships and balance history are immediately visible again because the row was preserved

Edge case: the user's original handle may have been re-claimed by someone else after redact. Onboarding's existing handle-uniqueness check handles this naturally — they pick a new one.

## Money-bearing FK behavior

Stays as `ON DELETE CASCADE`. Production code never deletes from `public.users` — only redacts. The cascade gun exists but its trigger is reachable only from test cleanup (`auth.admin.deleteUser`), which is gated by service-role.

### Belt-and-suspenders

- CLAUDE.md rule: "to delete a user, call `redact_user`. Never `auth.admin.deleteUser` outside `src/test/`."
- (Optional, later) CI grep check that fails the build if `auth.admin.deleteUser` appears outside `src/test/`.

The audit's recommendation to switch the four money-bearing FKs to `ON DELETE RESTRICT` was rejected. RESTRICT would force a test cleanup rewrite (every integration test deletes test users via cascade today) and the safety it provides is duplicated by the "redact-only production path" rule.

## Testing implications

Zero changes to existing integration tests. The cascade-via-`admin.deleteUser` teardown path keeps working because it's only invoked by tests, and tests intentionally want everything wiped.

New for this work:

- `src/lib/supabase/redact-user.integration.test.ts` covering:
  - Happy path: alice with expense + settlement history → `redact_user(alice.id)` clears PII, preserves FK rows, sets `deleted_at`, rewrites handle/name as specified
  - Auth: bob calling `redact_user(alice.id)` is rejected
  - Idempotency: second call on already-redacted user is no-op or clean rejection
  - Returning user: alice signs in again → her onboarding action clears `deleted_at` and updates fields → her group memberships and balance rows are visible to her

## Open questions parked for product

- Should the redact action invalidate existing Supabase sessions immediately (force sign-out on all devices)? Defaults to "yes" since it's typical for delete-account flows.
- Counterparty UX: should Bob see a small "Removido" badge next to Alice's avatar in the conversation list, or just the suffixed name? Pure UI choice.
- Push notifications: should we proactively unsubscribe the redacted user's `push_subscriptions` rows? Probably yes — clear them in `redact_user`.

## Scope estimate when this becomes work

- 1 migration: `deleted_at` column on `public.users` + `redact_user` RPC + post-signup trigger update for returning-user path
- 1 integration test file
- 1 line in CLAUDE.md (cascade safety rule)
- ~10 lines in the onboarding action to handle the soft-deleted case
- No test infra changes

Roughly one medium PR.
