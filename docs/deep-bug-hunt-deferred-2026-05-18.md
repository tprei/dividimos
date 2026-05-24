# Deep bug hunt — items deferred pending product input

Captured 2026-05-18. NOT tracked in git. Items below need product/architecture decisions before implementation; the autonomous pass skipped them.

## Deferred — needs user input

### 1. `/api/pix/generate` debt-link semantics (TL;DR #4 / fix-order #4)
**Question:** What constitutes a valid "debt link"? Options:
- Strict: only allow generation when caller has non-zero balance owed TO recipient
- Loose: allow within group membership (current — but no rate limit + no debt check)
- Tiered: caller can charge up to outstanding-balance amount; or with an "exceeds-balance confirmation" flag
**Why this needs you:** changes user-facing flow — what error/UI is shown when there's no debt? Does the app gracefully degrade or block? The Brazilian retail-Pix flow may expect generic charge generation.

### 2. Kick authoritativeness (TL;DR #7 / fix-order #8)
**Question:** Should a kick be reversible by other co-members? What does it mean semantically?
- Strict ban: ex-member cannot be re-added by ANY mechanism (invite link, direct re-add, guest claim, sign-in). Kick is permanent unless the creator removes the ban.
- Soft kick (current): any co-member can re-add via direct INSERT through RLS; old invite links continue to work.
- Tiered: only group creator can re-add a previously-kicked user.
**Why this needs you:** product UX decision — does the group's social contract treat kicks as serious (strict ban) or soft? Also implicates the `delete_group` RPC question — currently creator cannot leave; only escape is account deletion.

### 3. Client/server rounding alignment (acknowledged tradeoff / fix-order #11)
**Question:** Which rounding algorithm wins?
- Server-style per-pair ROUND with global residual reconciliation (current `activate_expense`)
- Client-style largest-remainder (pin per-user totals to validated shares; the deeper algorithm change)
**Why this needs you:** PR #442 chose server-style and accepted the per-user drift (documented in the migration and tests). Switching the server to largest-remainder is the deeper fix; switching the client to match server is the cheap fix. Both have UX implications.

### 4. `/u/[handle]` unauthenticated payload scope
**Sub-question:** PR #444 already routed through `lookup_user_by_handle` RPC. Should unauth visitors see `avatar_url`? The bug-hunt recommends dropping `id` and `avatar_url` for unauth payloads. This is a tiny product call — public profile page UX vs minimal PII surface.

## What this pass IS doing autonomously

- TL;DR #1 / fix-order #1: `/api/dev/login` hard-kill in non-dev
- TL;DR #3 / fix-order #3: Pix TLV correctness (UTF-8 byte count, CRC16 byte operation, key length cap)
- TL;DR #5 / fix-order #2: single RLS migration closing Chains C+D+J (chat_messages_insert `message_type`, expense child tables `status='draft'`, confirm_settlement debtor check, leave_group pending-settlement cleanup) + removing the lock-in tests
- fix-order #6: `server-only` guards on `crypto.ts`, push modules
- fix-order #9: `saveExpenseDraft` transactional via SECURITY DEFINER RPC + child-table locks in `activate_expense`
- fix-order #10: remove the test files that lock in bugs as expected behavior (chat-messages-forgery test, group-membership both-branches-pass, currency.test pinning bugs)
- fix-order #12: delete `public/manifest.webmanifest` (let dynamic manifest serve), add `data.url` re-validation in `public/sw.js`

Rate-limit wire-up (PR 2 of #445) is also autonomous-doable but is sequentially dependent on #445 being merged first; deferred until then.

Each item below ships as its own PR with explore → plan → impl → enemy review.
