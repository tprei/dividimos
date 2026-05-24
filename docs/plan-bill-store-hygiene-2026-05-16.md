# Bill-store hygiene plan (2026-05-16)

Addresses H1 (module cache), H3 (`computeLedger` writes), and H4 (external `setState`) from the state-management audit in `src/stores/bill-store.ts`.

## 1. `hydrateFromServer` action

Signature:

```
hydrateFromServer(input: {
  expense: Expense;
  items: ExpenseItem[];
  participants: User[];
  payers: ExpensePayer[];
  billSplits?: BillSplit[];
}): void
```

Minimal because the three current call sites all need exactly: expense row + items, plus (for the wizard edit path only) participants, payers, and reconstructed `billSplits` for `single_amount`. `creator-draft-view.tsx` and `bill/[id]/page.tsx` pass only `{ expense, items }` (and omit the rest, which clears them). The wizard edit path at `bill/new/page.tsx:466` passes all five.

`shares` is intentionally excluded: the store derives shares via `getExpenseShares()`. Callers that need server-side share amounts (the draft view) already render directly from `ExpenseWithDetails` props, not from store state.

## 2. State slices cleared before set

Before applying the new server snapshot, clear these to prevent zombie state from a prior wizard session: `totalAmountInput`, `participants`, `guests`, `items`, `payers`, `splits`, `billSplits`, `previewDebts`. Then overwrite with the provided values (defaulting omitted optional fields to `[]`). `currentUser` is preserved. `totalAmountInput` is set from `expense.totalAmount` when `expenseType === "single_amount"`, else `0`. The consumption cache is invalidated via the same helper `reset` uses.

## 3. Module cache replacement (H1)

Recommend **option (a): WeakMap keyed on the expense object reference**, plus invalidation on every mutating action that currently mutates a referenced input (`addItem`, `updateItem`, `removeItem`, `addParticipant`, `removeParticipant`, `addGuest`, `removeGuest`, `updateGuest`, all `split*`, `assign*`/`unassign*`, all payer mutations, `updateExpense`, `setExpenseType`).

Justification: `getExpenseShares` and `wouldProduceNoEdges` are called from non-React contexts (`buildDraftParams`, `computeShares` in `bill/new/page.tsx`), so a `useMemo`-only approach (option b) doesn't cover them. WeakMap keyed by `expense` object removes the SSR/multi-tab footgun (no module-level mutable singleton across requests in Next 16 RSC environments) and naturally invalidates when `createExpense` / `hydrateFromServer` / `reset` produce a new `expense` object. Keep `_testGetCacheState` shape compatible.

## 4. `computeLedger` cleanup (H3)

Stop writing `expense.status` and `expense.updatedAt`. Stop writing `previewDebts`. No production component reads `previewDebts` — `rg previewDebts src/components src/app` returns no hits. Only `dev-test-buttons.tsx:78` calls `computeLedger`, and 9 test files read `previewDebts`.

Migration:
- Convert `computeLedger` into a **pure selector** `selectPreviewDebts(state): DebtEdge[]` exported from the store module, or a derived selector hook `usePreviewDebts()` using `useShallow` over `(expense, participants, guests, payers, splits, billSplits, items, totalAmountInput)` plus `useMemo`.
- Remove `computeLedger` from the store action surface and remove `previewDebts` from `ExpenseState`.
- Update `dev-test-buttons.tsx:78` to drop the trailing `store.computeLedger()` call (it only existed to populate `previewDebts` for debugging; the selector replaces it).
- Update the 9 test files (see test impact) to call `selectPreviewDebts(useBillStore.getState())` instead of reading `state.previewDebts`. The `expense.status === "settled"` assertions in `bill-store.test.ts:325`, `single-amount-bill.test.ts:106`, and `edge-cases.test.ts:54` must be replaced by checking `selectPreviewDebts(...).length === 0` (or `wouldProduceNoEdges()`), because the store no longer fakes a status transition client-side.

The wizard step navigation at `bill/new/page.tsx:759-771` reads `store.participants.length` and `store.billSplits`, not `expense.status` or `previewDebts`. Confirmed: no gating logic depends on the removed client-computed status.

## 5. Call-site migration

Outside `src/stores/`, three production sites use `useBillStore.setState`:

- `src/app/app/bill/[id]/page.tsx:165-181` (`loadExpenseData` body) — replace with `useBillStore.getState().hydrateFromServer({ expense: <mapped>, items: data.items })`. This now also clears zombie `participants`/`payers`/`splits`/`billSplits`/`previewDebts` from a prior wizard, fixing the leak noted in the audit.
- `src/app/app/bill/[id]/page.tsx:253-257` (`onExpenseUpdate` realtime patch) — keep as a thin in-store action `patchExpenseFromRealtime({ id, status, updatedAt })` (per the data-fetching rule: realtime handlers patch, not reload). This is not a full snapshot, so it is not `hydrateFromServer`.
- `src/components/bill/creator-draft-view.tsx:57-72` (post-`activateExpense` reload) — replace with `hydrateFromServer({ expense: <mapped>, items: [] })`. Items aren't re-fetched here today; preserve that behavior.
- `src/app/app/bill/new/page.tsx:466-484` (wizard edit-draft hydration) — replace with `hydrateFromServer({ expense, items, participants, payers, billSplits })`. The `billSplits` reconstruction for `single_amount` (currently inline at :476-483) moves into the action body.
- `src/app/app/bill/new/page.tsx:773` (post-activation clear) — replace with `useBillStore.getState().reset()`. The partial clear today leaves `participants`/`guests`/`splits` stale; `reset` already clears everything and invalidates the cache.

`useBillStore.getState()` *read* call sites (e.g. `:402`, `:593`, `:604`, `:612`, `:675`, `:723` in `new/page.tsx`) are unchanged — only `setState` is the target.

## 6. Test impact

`src/stores/bill-store.test.ts` (19 describe blocks):
- **`computeLedger` describe (line 299)** — rewrite to call `selectPreviewDebts`; remove status assertions at :325.
- **`consumption memoization` (line 1169)** — `_testGetCacheState` shape preserved, but the WeakMap means `invalidates cache when state changes` (:1192) currently asserts `hasCachedResult: true` after a mutation (it re-fills the cache on next `computeLedger`). With WeakMap keyed on `expense`, intermediate mutations of `splits`/`billSplits` don't change the `expense` reference, so the cache key still matches but the *content* is stale — this is the bug. Plan: include all inputs that affect consumption in the key (compound key: keep WeakMap on `expense`, store an inner key of `{participants, guests, items, splits, billSplits}` reference tuple). Update this test to assert correctness of returned shares, not internal cache hit/miss flags.
- **`reset` (line 450), `hydrateFromVoice` (line 474), `createExpenseFromDm` (line 922), `hydrateFromChatDraft` (line 983)** — all assert `previewDebts: []` (`:470`, `:957`, `:1144`). Replace with `selectPreviewDebts(...).length === 0`.

Flow tests (`__tests__/flows/*.test.ts`, ~40 `previewDebts` reads across 5 files) all need the same mechanical swap to `selectPreviewDebts`. `edit-draft.test.ts` sets `previewDebts: []` inside literal `setState({...})` payloads (:52, :83, :104, :135, :168, :191) — these tests should switch to invoking `hydrateFromServer` directly, which is the production code path they're meant to cover anyway.

New tests required for `hydrateFromServer`: (a) clears prior wizard state including guests and splits; (b) sets `totalAmountInput` only for `single_amount`; (c) reconstructs `billSplits` from shares for `single_amount`; (d) preserves `currentUser`; (e) invalidates consumption cache.

## 7. PR scope

**One PR.** H1, H3, and H4 are mechanically coupled: removing `previewDebts` from state (H3) requires updating every test and the dev-test-buttons consumer; introducing `hydrateFromServer` (H4) is the natural moment to also fix the cache-invalidation bug exposed by H1 (the new action must invalidate cleanly). Splitting risks landing an intermediate state where call sites still write `expense.updatedAt`/`status` via `setState` while the store no longer trusts those fields. The blast radius is contained to `bill-store.ts`, three production consumers, and the test suite — all touched in the same logical change.

## Risks

- **`computeLedger` callers in tests assume side-effect on state.** All 9 test files require the swap; missing one yields a silent test failure on `previewDebts is undefined`. Search guard before merge: `rg "previewDebts|\\.computeLedger\\(" src/`.
- **WeakMap key needs to include split/payer inputs.** A WeakMap keyed only on `expense` is insufficient since `splits`/`billSplits`/`items` mutate without changing the `expense` reference. The compound-key approach (WeakMap outer + reference-tuple inner) is required.
- **Wizard step navigation** (`bill/new/page.tsx:759-771`, :790-810) reads `store.participants.length`, `store.billSplits`, `store.guests`. Confirmed unaffected — no read of `expense.status` or `previewDebts` for gating.
- **`onExpenseUpdate` realtime handler** must remain a patch, not a full hydrate. Introducing a separate `patchExpenseFromRealtime` action keeps that boundary explicit and prevents future regressions where someone calls `hydrateFromServer` from a realtime callback (which would violate the "patch, not reload" rule).
