# Testing fixes -- 2026-04-01

Four issues surfaced during manual testing. Issue 1 is already resolved (migration applied). Issues 2-4 require code changes.

---

## Issue 1: Group invite links missing from remote DB (RESOLVED)

Migration `20260401200000_create_group_invite_links.sql` was applied to remote Supabase. No code changes needed.

**Status**: Done.

---

## Issue 2: Payments tab does not refresh after recording a settlement

### Problem

`GroupSettlementView.handleRecordSettlement()` calls `recordSettlement()`, closes the modal, but never tells the parent page to refetch data. The "acerto" tab updates via `useRealtimeBalances`, but the "pagamentos" tab (settlement history list) stays stale until a manual page reload.

### Root cause

`handleRecordSettlement` at `src/components/group/group-settlement-view.tsx` line 204 completes the RPC and closes state, but dispatches no refresh signal. The parent `GroupDetailPage` (`src/app/app/groups/[id]/page.tsx`) already listens for `app-refresh` custom events (lines 261-268) and calls `fetchGroup()` which refetches settlements.

### File changes

| File | Change |
|------|--------|
| `src/components/group/group-settlement-view.tsx` | After `setActing(null)` on line 207, add `window.dispatchEvent(new CustomEvent("app-refresh"))` |

### Why this approach

The parent already wires up an `app-refresh` listener that triggers `fetchGroup()`. Dispatching the event from the child avoids adding new props, callbacks, or lifting state. It follows the same pattern used elsewhere in the app for cross-component refresh signaling.

### Validation

1. Open a group with outstanding balances
2. Go to the "acerto" tab and record a settlement (Pix flow)
3. Switch to the "pagamentos" tab -- the new settlement should appear immediately without a page reload
4. Confirm the "acerto" tab balances also update (existing realtime behavior, should not regress)

---

## Issue 3: Unhelpful disabled message on group selector for pending-invite groups

### Problem

When all group members have pending invites, the group row in the expense wizard is disabled with the message "Membros com convite pendente". This is technically accurate but gives no guidance on what the user should do.

### Root cause

`src/components/bill/group-selector.tsx` line 203 renders a static string when `group.hasPendingInvites` is true.

### File changes

| File | Change |
|------|--------|
| `src/components/bill/group-selector.tsx` | Change the message at line 203-204 from `"Membros com convite pendente"` to `"Aguardando membros aceitarem o convite"` |

### Why this approach

The new text explains the current state ("waiting") and implies the resolution (members need to accept). It stays concise and fits the existing UI layout. No structural changes needed.

### Validation

1. Create a group and invite a user who has not yet accepted
2. Open the expense creation wizard
3. The group should appear disabled with the text "Aguardando membros aceitarem o convite"
4. Confirm groups with accepted members still show their normal addable-count text

---

## Issue 4: Group bill summary lacks hint about debtor settlement flow

### Problem

On the group bill summary page (`/app/bill/[id]`), the payment tab shows a link to the group page and lists debts, but gives no indication that debtors can settle from their own view. Users who created the bill may not realize they don't need to chase people -- debtors see and can pay from the group page directly.

### Root cause

The debt list in `src/app/app/bill/[id]/page.tsx` lines 865-907 renders each debt card without any contextual guidance. The "Ir para acerto do grupo" link above addresses the current user's own debts but doesn't explain the debtor-side experience.

### File changes

| File | Change |
|------|--------|
| `src/app/app/bill/[id]/page.tsx` | After the debt list `</div>` closing tag (around line 906-907), add an informational note element |

The note should use a subtle info style consistent with the existing `border-primary/20 bg-primary/5` pattern already used in the "Ir para acerto do grupo" link above. Content:

```
Os devedores podem ver e quitar essas dividas na pagina do grupo.
```

Use an `Info` icon from lucide-react (already available in the project) at a small size, paired with `text-xs text-muted-foreground` text. Wrap in a `<p>` or `<div>` with `flex items-center gap-2 mt-3 px-1`.

### Why this approach

A lightweight text hint avoids adding interactive elements or restructuring the page. It educates the bill creator that the system handles debtor notification/settlement flow through the group page, reducing the urge to manually chase payments.

### Validation

1. Create a group bill with multiple participants and activate it
2. View the bill summary page and switch to the payment tab
3. Confirm the informational note appears below the debt list
4. Confirm the note does not appear for non-group bills (the block is already gated on `expense.groupId` at line 844)

---

## Implementation order

1. **Issue 2** -- Settlement refresh. Smallest change, highest user-facing impact.
2. **Issue 3** -- Group selector message. One string replacement.
3. **Issue 4** -- Info hint on bill summary. Small addition, no logic changes.

## Files touched (summary)

- `src/components/group/group-settlement-view.tsx`
- `src/components/bill/group-selector.tsx`
- `src/app/app/bill/[id]/page.tsx`

## Open questions

None. All three remaining fixes are self-contained UI changes with no schema, RPC, or migration work.
