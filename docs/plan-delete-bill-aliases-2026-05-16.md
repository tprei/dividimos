# Plan: delete legacy `Bill*` type aliases

Date: 2026-05-16
Branch: `u-handle-server-component` (worktree)
Scope: remove the legacy `Bill*` aliases at `src/types/index.ts:421-537` and migrate every production caller off them.

## Audit summary

- `src/types/database.ts` is already clean. No `bills`, `bill_items`, `bill_splits`, or `ledger_entries` tables - only the new `expenses`, `expense_items`, `expense_shares`, `expense_payers`, `expense_guests`, `expense_guest_shares`, `settlements`, and `balances` tables (`src/types/database.ts:42-895`). The Bill-era SQL schema is gone; only TypeScript carries the dead weight.
- The legacy block lives at `src/types/index.ts:421-538` with 14 exports:  `BillType`, `BillStatus`, `BillPayer`, `Bill`, `BillItem`, `BillSplit`, `ItemSplit`, `DebtStatus`, `LedgerEntryType`, `BillParticipantStatus`, `GroupSettlement`, `BillParticipant`, `LedgerEntry`, `BillWithDetails`.
- `src/components/settlement/charge-explanation.tsx` is dead code. The active page `src/app/app/bill/[id]/page.tsx:20` imports `ExpenseChargeExplanation` from `@/components/bill/expense-charge-explanation` instead. No other file imports `charge-explanation`.

## Type-by-type kill list

| Legacy type | Action | Replacement / notes |
|---|---|---|
| `Bill` | Delete | Use `Expense`. Callers: `simplify.ts`, `demo/page.tsx`, `charge-explanation.tsx` (dead), `fixtures.ts`, `types/index.test.ts`. `Bill` carries `billType`, `totalAmountInput`, and `payers: BillPayer[]` that `Expense` does not - migration must hold these locally where still needed (only the demo page genuinely needs them). |
| `BillType` | Delete | Use `ExpenseType`. Pure alias. |
| `BillStatus` | Delete | Use `ExpenseStatus`. Note: `BillStatus` includes an extra `"partially_settled"` literal not in `ExpenseStatus`. No production code references that literal (grep confirms). Safe to drop. |
| `BillPayer` | Delete | Use `ExpensePayer`. Shape difference: `BillPayer = { userId, amountCents }`, `ExpensePayer = { expenseId, userId, amountCents }`. Demo callers can synthesize `expenseId` from the local `BILL_ID` constant. |
| `BillItem` | Delete | Use `ExpenseItem`. Shape difference: `billId` vs `expenseId`. Update `DEMO_ITEMS` and `demo/page.tsx`. |
| `BillSplit` | Rename | Move into `src/stores/bill-store.ts` as an internal `AmountSplit` interface. Not persisted to DB and not part of the `Expense*` domain. The wizard uses it only for single_amount entry; activation transforms it into `ExpenseShare[]` via `getExpenseShares()` (bill-store.ts:596-614). |
| `ItemSplit` | Rename | Move into `src/stores/bill-store.ts` as an internal `ItemAssignment` interface. Same rationale - wizard state, not DB. The `id` field is a local `generateId()` value, never round-tripped to Supabase. |
| `DebtStatus` | Delete | Demo page synthesizes its own `"pending" | "settled"` state. Replace `DebtStatus` with a local string-union in `demo/page.tsx`. The `coerceDebtStatus` import on `demo/page.tsx:25` becomes obsolete (see type-guards section). |
| `LedgerEntryType` | Delete | Unused outside `LedgerEntry`. |
| `BillParticipantStatus` | Delete | Unused. Group membership uses `GroupMemberStatus`. |
| `GroupSettlement` | Delete | Replaced by `Settlement`. Zero callers in `src/`. |
| `BillParticipant` | Delete | Group members use `GroupMember`. Zero callers. |
| `LedgerEntry` | Delete | Demo page uses it for in-memory display state - replace with `DebtEdge` plus a local `displayId`/status overlay (Demo logic already simulates payments client-side). |
| `BillWithDetails` | Delete | Replaced by `ExpenseWithDetails`. Zero callers. |

## Per-file migration table

| File | Current legacy use | Action |
|---|---|---|
| `src/types/index.ts:421-538` | All 14 aliases | Final PR: delete entire `Legacy type aliases` section. |
| `src/types/index.test.ts:24-29,431-479` | Imports + 4 alias compatibility tests | Final PR: delete the imports and the `describe("Legacy type aliases")` block. |
| `src/stores/bill-store.ts:13-14,42-44,127-128,170-171,370,398,462,476,486` | `ItemSplit`, `BillSplit` from `@/types` | Define `ItemAssignment`, `AmountSplit` locally in `bill-store.ts`. Export from the store so the wizard step component can consume them. Update consumers below. |
| `src/stores/bill-store.test.ts` | No direct type imports - line 357 only mentions `LedgerEntry` in a comment | No code changes needed. Optionally update the stale comment. |
| `src/lib/simplify.ts:2,82-86,93,102,103,110,118-120` | `Bill`, `BillSplit`, `ItemSplit` | Rewrite `computeRawEdges` signature. Read sites are: `bill.billType`, `bill.serviceFeePercent`, `bill.fixedFees`, `bill.payers`, `bill.creatorId`. Replace with a minimal struct: `{ expenseType, serviceFeePercent, fixedFees, creatorId, payers: { userId, amountCents }[] }`. The new param name should be `expense` to align with domain types but with a permissive structural type so the demo page (which lacks an `id`/`groupId` etc.) still satisfies it. Import `ItemAssignment` and `AmountSplit` from `@/stores/bill-store` (or - cleaner - lift them to a `src/types/wizard.ts` file). |
| `src/lib/simplify.test.ts:2,3,49-55,67,80,96,...` (~10+ lines) | `makeItemizedBill`, `makeSingleAmountBill`, `BillSplit`, `ItemSplit`, `makeItemSplit`, `makeBillSplit` helpers | Migrate fixtures to `makeExpense`/`makeSingleAmountExpense` + locally-typed split arrays. Update `computeRawEdges` callers to pass the new minimal shape. |
| `src/components/settlement/charge-explanation.tsx` | All `Bill*` types | Delete the file entirely. No importers. |
| `src/components/bill/wizard/split-step.tsx:7,11` | `ItemSplit` | Re-import as `ItemAssignment` (or whatever the rename lands on). One line of import + one type annotation change. |
| `src/components/bill/wizard/split-step.test.tsx:5,109` | `ItemSplit` | Same renamed import. The test fixture `splits` array stays unchanged in shape. |
| `src/lib/demo-data.ts:1,81` | `BillItem` (via `Omit`) | Switch to `Omit<ExpenseItem, "id" | "expenseId" | "createdAt">`. Type-compatible: both shapes have identical non-id fields. |
| `src/app/demo/page.tsx:26,33,49,72,93,138,169,208` | `Bill`, `BillItem`, `DebtStatus`, `ItemSplit`, `LedgerEntry`, plus `coerceDebtStatus` | Rewrite `buildDemoData()` to construct an `Expense` and local `ItemAssignment[]` and `DebtEdge[]`. Wrap demo-only fields (`totalAmountInput`, simulated `payers`) into a local type `DemoBill` declared inline. The demo display layer needs `paidAmountCents` and a status overlay; keep those as local `Map<string, number>` state (already the case at lines 169-170). Drop `coerceDebtStatus`. |
| `src/test/fixtures.ts:1,85-150` | `makeItemizedBill`, `makeSingleAmountBill`, `makeBillItem`, `makeLedgerEntry` and `Bill`/`BillItem`/`LedgerEntry` imports | Delete the four `@deprecated` helpers. Only `simplify.test.ts` still uses them - migrate that test first. |
| `src/lib/type-guards.ts` | `BillStatus`, `BillType`, `BillParticipantStatus`, `DebtStatus` imports + assert/coerce/is for each | Delete: `BILL_STATUSES`, `BILL_TYPES`, `BILL_PARTICIPANT_STATUSES`, `DEBT_STATUSES` consts plus `isBillStatus`, `isBillType`, `isBillParticipantStatus`, `isDebtStatus`, `assertBillStatus`, `assertBillType`, `assertSplitType`, `assertDebtStatus`, `coerceBillStatus`, `coerceBillType`, `coerceSplitType`, `coerceDebtStatus`. Production callers: only `demo/page.tsx:25,223` uses `coerceDebtStatus` and the migration removes that callsite. `isGroupMemberStatus`, `isSplitType`, and `isPixKeyType` stay (`isPixKeyType` is tested at `src/lib/type-guards.test.ts`). `isSplitType` has no callers - audit-driven decision: keep it because `SplitType` is still a live domain type and removing the guard would require re-adding it later. |

## Verification of "is it actually used?"

Confirmed via grep across `src/`:

- `BillParticipant`, `BillParticipantStatus`, `GroupSettlement`, `LedgerEntryType`, `BillWithDetails` -> **zero** non-type-definition references.
- `LedgerEntry` -> only `demo/page.tsx` and `fixtures.ts` (via `makeLedgerEntry`, only called from `simplify.test.ts` indirectly? actually no - grepping shows `makeLedgerEntry` has zero callers).
- `DebtStatus` -> only `demo/page.tsx` (state typing) and `type-guards.ts`.
- `Bill`, `BillItem`, `BillSplit`, `ItemSplit`, `BillPayer`, `BillStatus`, `BillType` -> the eight files in the migration table.

## PR split (recommendation: option B)

Atomic option A would be ~9 files touching the store, demo page, simplify, fixtures, type-guards, types, and three tests in one go - hard to review and easy to merge-conflict against ongoing chat/store work. Use four sequenced PRs:

### PR 1 - delete dead code (low risk)

- Delete `src/components/settlement/charge-explanation.tsx` (245 LOC).
- Delete from `src/lib/type-guards.ts`: `isBillStatus`, `isBillType`, `isBillParticipantStatus`, `isDebtStatus`, `assertBillStatus`, `assertBillType`, `assertSplitType`, `assertDebtStatus`, `coerceBillStatus`, `coerceBillType`, `coerceSplitType`, `coerceDebtStatus`, and their `BILL_*`/`DEBT_STATUSES` consts.
- Update `src/app/demo/page.tsx` to inline a local two-state string union for the in-memory debt status overlay (replaces `coerceDebtStatus(get(...), "pending")` with a simple `?? "pending"` once the map value type narrows from `DebtStatus` to `"pending" | "settled"`).
- Files touched: 3. No type aliases removed yet - this PR just stops new code paths from leaning on them.

### PR 2 - rename `simplify.ts` and `demo-data.ts` off `Bill*`

- Change `computeRawEdges` signature in `src/lib/simplify.ts` to accept a minimal struct of `{ expenseType, serviceFeePercent, fixedFees, creatorId, payers }`. Update the JSDoc.
- Update `src/lib/demo-data.ts` to use `Omit<ExpenseItem, "id" | "expenseId" | "createdAt">`.
- Update `src/app/demo/page.tsx` to build an `Expense` + local `DemoBill` (carries `totalAmountInput`, demo `payers` synthesis). Keep `splits: ItemAssignment[]` typed against the store-exported alias once PR 3 lands - or, in this PR, define inline if PR 3 hasn't merged yet. Reorder PRs if needed (see below).
- Update `src/lib/simplify.test.ts` to use `makeExpense` instead of `makeItemizedBill` and pass the minimal struct. Replace `makeItemSplit`/`makeBillSplit` fixture helpers with plain literals or local helpers.
- Files touched: 4. Risk: medium - `simplify.ts` is hot path for debt display; the public-facing demo page is user-visible. Mitigation in risks section below.

### PR 3 - rename store internals (`ItemSplit`/`BillSplit` -> `ItemAssignment`/`AmountSplit`)

- In `src/stores/bill-store.ts`, drop the type imports of `ItemSplit, BillSplit` from `@/types` and replace with local exported interfaces `ItemAssignment` and `AmountSplit`. Field shapes stay identical so test mocks and `setState` payloads in `edit-draft.test.ts` keep working.
- Update `src/components/bill/wizard/split-step.tsx` and `src/components/bill/wizard/split-step.test.tsx` imports.
- Update `src/__tests__/flows/edit-draft.test.ts` imports.
- Files touched: 4. Risk: low - rename only, no field changes. `bill-store.test.ts` has no direct type imports (line 357 only a comment) so it's unaffected.

### PR 4 - delete the aliases (final, mechanical)

- Delete `src/types/index.ts:421-538` entirely.
- Delete `src/test/fixtures.ts` legacy helpers (`makeItemizedBill`, `makeSingleAmountBill`, `makeBillItem`, `makeLedgerEntry`) and the `Bill`, `BillItem`, `LedgerEntry` import at line 1.
- Delete the `describe("Legacy type aliases", ...)` block at `src/types/index.test.ts:431-479` plus the legacy imports at lines 24-29.
- Run `npm run build` to confirm zero references remain. If anything still references a deleted alias, that's a missed migration site - fix it in this PR (it'll be a single-line import).
- Files touched: 3.

Total: ~14 file edits across four PRs, with PRs 1, 3, and 4 each ~ trivial review surface and PR 2 carrying the bulk of the risk.

### Ordering note

PR 3 (store rename) is independent of PRs 1-2 and can land anytime before PR 4. If PR 2's demo migration is unblocked by PR 3 (since `simplify.test.ts` and the demo split arrays may want to import `ItemAssignment`), land PR 3 first. Suggested order: **1 -> 3 -> 2 -> 4**, because PR 2 is the largest and benefits from the rename already being available.

## Test impact

Files needing updates (in lockstep with the rename PRs):

| Test file | What changes | PR |
|---|---|---|
| `src/components/settlement/charge-explanation.test.*` | None - no test file exists | PR 1 (n/a) |
| `src/lib/type-guards.test.ts` | None - only tests `isPixKeyType`, which we keep | PR 1 (n/a) |
| `src/lib/simplify.test.ts` | Replace `makeItemizedBill`, `makeSingleAmountBill`, `makeItemSplit`, `makeBillSplit` helpers and the `BillSplit`/`ItemSplit` imports. Adapt `computeRawEdges` call sites to the new minimal struct (only `billType` -> `expenseType` rename plus drop `totalAmountInput`/`status`/`title` fields the tests pass but the function ignores). ~10+ call sites. | PR 2 |
| `src/components/bill/wizard/split-step.test.tsx` | One-line import rename of `ItemSplit` -> `ItemAssignment` plus the typed `splits` array (line 109) keeps the same fields. | PR 3 |
| `src/__tests__/flows/edit-draft.test.ts` | Same import rename for both `BillSplit` and `ItemSplit`. Two typed array declarations at lines 31 and 69, plus 148. Field shapes unchanged. | PR 3 |
| `src/__tests__/flows/settlement.test.ts` | No code changes. Comment at line 53 mentions "LedgerEntry" - can be updated for accuracy but not load-bearing. | PR 4 (optional) |
| `src/stores/bill-store.test.ts` | No code changes. Stale comment at line 357 mentions "LedgerEntry" - can be updated. | PR 4 (optional) |
| `src/types/index.test.ts` | Delete the `describe("Legacy type aliases")` block plus six legacy imports. | PR 4 |
| `src/components/bill/swipeable-bill-card.test.tsx` | No changes - "Bill" in this file is the component name and the UI text "Bill content", unrelated to the alias removal. Component-level rename to `SwipeableExpenseCard` is out of scope. | n/a |

Estimated total test-file LOC churn: ~80 lines, mostly in `simplify.test.ts`.

## Risks and mitigations

1. **`bill-store.ts` is 783 LOC with deep test coverage**: the rename in PR 3 is field-preserving, so `useBillStore.setState({ splits: [...] })` payloads in `edit-draft.test.ts` continue to type-check. Mitigation: keep the interface fields byte-identical (`id`, `itemId`, `userId`, `splitType`, `value`, `computedAmountCents`). No structural changes.

2. **`computeRawEdges` is called by the demo page only** (`src/app/demo/page.tsx:190`). The function reads `bill.billType`, `bill.serviceFeePercent`, `bill.fixedFees`, `bill.payers`, `bill.creatorId` (simplify.ts:93, 102, 110, 118-120). Mitigation: replace the parameter type with a minimal struct that demo-page callers can satisfy without holding the obsolete `Bill` shape. Update the function body to read `expense.expenseType` instead of `bill.billType`. Use exhaustive grep + `npm run build` to confirm no production caller is broken.

3. **Demo page is user-visible** (public marketing at `/demo`). The numerical output must match exactly post-migration so that the precomputed showcase still shows the same debt graph. Mitigation: keep the math identical and don't touch the `splitAssignments` array, `serviceFee` calculation, `payerAmounts` ratios, or the netting loop. Manual smoke test: open `/demo`, switch through Itens/Divisão/Pagamento tabs, verify the same six users with the same Pix amounts.

4. **`simplifyDebts` does NOT consume `Bill`** (simplify.ts:148). Only `computeRawEdges` does. The signature of `simplifyDebts` operates on `DebtEdge[]` and `User[]` - safe.

5. **`BillStatus` includes `"partially_settled"` which `ExpenseStatus` lacks**. No production code references that literal (grep across `src/` confirms). Tests previously typed against `BillStatus` use only `"draft" | "active" | "settled"`. Safe to drop.

6. **`BillError` and `DraftError` in `src/lib/errors.ts:175-201` plus their `BILL_*`/`DRAFT_*` error codes**: Out of scope for this cleanup. They are a different layer (runtime error classes, not domain types) and the tech-debt audit grouped them separately. Recommend a follow-up PR titled "rename Bill/Draft error classes to Expense error classes" that updates `ErrorCode` literals, the class names, and any callers - then a third audit pass to verify zero callers remain. Including them here would conflate domain type renames with error-handling renames and bloat the diff.

7. **`charge-explanation.tsx` deletion is irreversible via diff** but has zero importers, no test file, and the live app uses a separately-named `ExpenseChargeExplanation`. Safe.

## Order of operations

1. **PR 1** - dead-code removal (`charge-explanation.tsx`, unused type-guard helpers, replace `coerceDebtStatus` call in demo with inline narrowing). Smallest review surface. Lands first to shrink subsequent diffs.
2. **PR 3** - store internal rename (`ItemSplit`/`BillSplit` -> `ItemAssignment`/`AmountSplit`). Independent of PR 2. Mechanical.
3. **PR 2** - `simplify.ts`, `demo-data.ts`, and `demo/page.tsx` migration. Highest risk; lands once PR 3 makes the wizard type names canonical.
4. **PR 4** - delete the alias block and the legacy fixture helpers; delete the legacy-aliases test describe block. Mechanical and proves the migration is complete (build fails if any caller was missed).

Each PR runs `npm run build` and `npm run test` as the green gate. PR 2 additionally requires a manual `/demo` smoke test.

## Out of scope (documented for follow-up)

- Renaming `BillError`/`DraftError` error classes and the `BILL_*`/`DRAFT_*` `ErrorCode` literals in `src/lib/errors.ts`.
- Renaming `useBillStore` -> `useExpenseStore`, file `bill-store.ts` -> `expense-store.ts`, and the `src/components/bill/` directory -> `src/components/expense/`. These are pure cosmetic moves with ~50+ import-site updates and zero behavior change; tackle separately to avoid churn.
- Renaming `SwipeableBillCard` -> `SwipeableExpenseCard` and the `app/bill/[id]` route -> `app/expense/[id]`. Route rename in particular requires redirect handling.
